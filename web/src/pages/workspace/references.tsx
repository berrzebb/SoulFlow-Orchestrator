import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { Modal, DeleteConfirmModal } from "../../components/modal";
import { FormGroup } from "../../components/form-group";
import { WsSkeletonCol } from "./ws-shared";
import { SearchInput } from "../../components/search-input";
import { useToast } from "../../components/toast";
import { useAsyncState } from "../../hooks/use-async-state";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import { DataTable } from "../../components/data-table";

interface RefDocument {
  path: string;
  chunks: number;
  size: number;
  updated_at: string;
}

interface RefStats {
  total_docs: number;
  total_chunks: number;
  last_sync: string | null;
}

interface RefSearchResult {
  doc_path: string;
  heading?: string;
  content: string;
  score: number;
}

function format_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReferencesTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadBase64, setUploadBase64] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RefSearchResult[] | null>(null);
  const { pending: searching, run: run_search } = useAsyncState();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ documents: RefDocument[]; stats: RefStats }>({
    queryKey: ["references"],
    queryFn: () => api.get("/api/references"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const docs = data?.documents ?? [];
  const stats = data?.stats;

  const sync = useMutation({
    mutationFn: () => api.post<{ ok: boolean; added?: number; updated?: number; removed?: number }>("/api/references/sync", {}),
    onSuccess: (result: { ok: boolean; added?: number; updated?: number; removed?: number }) => {
      toast(t("references.sync_result", { added: result.added ?? 0, updated: result.updated ?? 0, removed: result.removed ?? 0 }), "ok");
      void qc.invalidateQueries({ queryKey: ["references"] });
    },
    onError: () => toast(t("references.sync_failed"), "err"),
  });

  const reset_upload = () => {
    setShowUpload(false);
    setUploadName("");
    setUploadContent("");
    setUploadBase64(null);
    setUploadProgress(null);
  };

  const do_upload = (body: { filename: string; content?: string; base64?: string }) => {
    setUploadProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/references/upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        toast(t("references.uploaded"), "ok");
        reset_upload();
        void qc.invalidateQueries({ queryKey: ["references"] });
      } else {
        toast(t("references.upload_failed"), "err");
        setUploadProgress(null);
      }
    };
    xhr.onerror = () => { toast(t("references.upload_failed"), "err"); setUploadProgress(null); };
    xhr.ontimeout = () => { toast(t("references.upload_failed"), "err"); setUploadProgress(null); };
    xhr.onabort = () => setUploadProgress(null);
    xhr.timeout = 120_000;
    xhr.send(JSON.stringify(body));
  };

  const remove = useMutation({
    mutationFn: (filename: string) => api.del(`/api/references/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      toast(t("references.deleted"), "ok");
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["references"] });
    },
    onError: () => toast(t("references.delete_failed"), "err"),
  });

  const do_search = () => {
    if (!searchQuery.trim()) return;
    void run_search(async () => {
      const res = await api.post("/api/references/search", { query: searchQuery, limit: 8 }) as { results: RefSearchResult[] };
      setSearchResults(res.results);
    }, undefined, t("references.search_failed"));
  };

  const BINARY_EXTS = new Set(["pdf", "docx", "pptx", "hwpx"]);
  const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

  // 대용량 파일도 안전하게 처리하는 청크 기반 base64 인코딩
  const to_base64 = (buf: ArrayBuffer): string => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };

  const handle_file_select = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    setUploadName(file.name);
    if (IMAGE_EXTS.has(ext) || BINARY_EXTS.has(ext)) {
      const buf = await file.arrayBuffer();
      const b64 = to_base64(buf);
      setUploadBase64(b64);
      setUploadContent(IMAGE_EXTS.has(ext)
        ? `data:${file.type};base64,${b64}`
        : `[바이너리 파일: ${file.name}, ${(file.size / 1024).toFixed(1)} KB]`
      );
    } else {
      const text = await file.text();
      setUploadContent(text);
      setUploadBase64(null);
    }
  };

  return (
    <div className="ws-references">
      {/* Header bar */}
      <div className="ws-references__header">
        <div className="ws-references__stats">
          {stats && (
            <>
              <Badge status={`${stats.total_docs} ${t("references.docs")}`} variant="info" />
              <Badge status={`${stats.total_chunks} ${t("references.chunks")}`} variant="info" />
              {stats.last_sync && (
                <span className="text-xs text-muted" title={stats.last_sync}>
                  {t("references.last_sync")}: {time_ago(stats.last_sync)}
                </span>
              )}
            </>
          )}
        </div>
        <div className="ws-references__actions">
          <button className="btn btn--xs" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? t("references.syncing") : t("references.sync")}
          </button>
          <button className="btn btn--xs btn--accent" onClick={() => setShowUpload(true)}>
            {t("references.upload")}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="ws-references__search">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("references.search")}
          onClear={() => setSearchQuery("")}
          autoFocus
        />
        <button className="btn btn--xs" onClick={() => void do_search()} disabled={searching || !searchQuery.trim()}>
          {searching ? t("common.searching") : t("common.search")}
        </button>
      </div>

      {/* Search results */}
      {searchResults && (
        <div className="ws-references__results">
          <div className="ws-references__results-header">
            <span className="fw-600 text-sm">{t("references.results")} ({searchResults.length})</span>
            <button className="btn btn--xs" onClick={() => setSearchResults(null)}>{t("common.close")}</button>
          </div>
          {searchResults.length === 0 ? (
            <div className="text-muted text-sm p-2">{t("references.no_results")}</div>
          ) : (
            <div className="ws-references__result-list">
              {searchResults.map((r, i) => (
                <div key={i} className="ws-references__result-item">
                  <div className="ws-references__result-meta">
                    <span className="fw-600 text-xs">{r.doc_path}</span>
                    {r.heading && <span className="text-xs text-muted"> — {r.heading}</span>}
                    <Badge status={`${(r.score * 100).toFixed(0)}%`} variant={r.score > 0.5 ? "ok" : "info"} />
                  </div>
                  <pre className="ws-references__result-content">{r.content.slice(0, 500)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document list */}
      {isLoading ? (
        <WsSkeletonCol rows={["text", "text", "text-sm"]} />
      ) : !docs.length ? (
        <EmptyState title={t("references.no_documents")} description={t("references.no_documents_hint")} />
      ) : (
        <DataTable>
            <thead>
              <tr>
                <th>{t("references.filename")}</th>
                <th>{t("references.chunks")}</th>
                <th>{t("references.size")}</th>
                <th>{t("references.updated")}</th>
                <th className="th--actions"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const filename = doc.path.split("/").pop() ?? doc.path;
                const ext = filename.split(".").pop()?.toLowerCase() ?? "";
                return (
                  <tr
                    key={doc.path}
                    className={selectedDoc === doc.path ? "tr--selected" : ""}
                    onClick={() => setSelectedDoc(selectedDoc === doc.path ? null : doc.path)}
                  >
                    <td>
                      <span className="ws-references__file-icon">{ext_icon(ext)}</span>
                      <span className="fw-500">{filename}</span>
                    </td>
                    <td className="text-xs">{doc.chunks}</td>
                    <td className="text-xs">{format_size(doc.size)}</td>
                    <td className="text-xs text-muted" title={doc.updated_at}>{doc.updated_at ? time_ago(doc.updated_at) : "—"}</td>
                    <td>
                      <button
                        className="btn btn--xs btn--danger"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(filename); }}
                        aria-label={t("common.delete")}
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
      )}

      {/* Upload modal */}
      <Modal
        open={showUpload}
        title={t("references.upload_title")}
        onClose={reset_upload}
        onConfirm={() => {
          if (!uploadName) return;
          if (uploadBase64) do_upload({ filename: uploadName, base64: uploadBase64 });
          else if (uploadContent) do_upload({ filename: uploadName, content: uploadContent });
        }}
        confirmLabel={uploadProgress !== null ? `${uploadProgress}%` : t("references.upload")}
        submitDisabled={!uploadName || (!uploadContent && !uploadBase64) || uploadProgress !== null}
      >
        <div className="modal__form-body">
          <FormGroup label={t("references.select_file")}>
            <input
              type="file"
              className="form-input"
              accept=".md,.txt,.json,.yaml,.yml,.csv,.xml,.html,.log,.ts,.js,.py,.sh,.sql,.toml,.ini,.cfg,.pdf,.docx,.pptx,.hwpx,.jpg,.jpeg,.png,.gif,.webp"
              onChange={(e) => void handle_file_select(e)}
              disabled={uploadProgress !== null}
            />
          </FormGroup>
          <FormGroup label={t("references.filename")}>
            <input
              className="form-input"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="document.md"
              autoFocus
              disabled={uploadProgress !== null}
              onKeyDown={(e) => { if (e.key === "Enter" && uploadName && uploadContent) do_upload({ filename: uploadName, content: uploadContent }); }}
            />
          </FormGroup>
          {uploadProgress !== null && (
            <div className="ws-references__progress">
              <div className="ws-references__progress-bar" style={{ width: `${uploadProgress}%` }} />
              <span className="ws-references__progress-label">{uploadProgress}%</span>
            </div>
          )}
          <FormGroup label={t("references.content_preview")}>
            {uploadContent.startsWith("data:image/") ? (
              <img
                src={uploadContent}
                alt={uploadName}
                className="ws-references__image-preview"
              />
            ) : (
              <>
                <textarea
                  className="form-input ws-references__preview-textarea"
                  value={uploadContent.startsWith("[바이너리") ? uploadContent : uploadContent.slice(0, 2000)}
                  readOnly
                  rows={6}
                  placeholder={t("references.content_preview_hint")}
                />
                {!uploadContent.startsWith("[바이너리") && uploadContent.length > 2000 && (
                  <span className="text-xs text-muted">{t("references.content_truncated", { total: uploadContent.length })}</span>
                )}
              </>
            )}
          </FormGroup>
        </div>
      </Modal>

      {/* Delete confirm */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("references.delete_title")}
        message={t("references.delete_confirm", { name: deleteTarget ?? "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        confirmLabel={t("common.delete")}
      />
    </div>
  );
}

function ext_icon(ext: string): string {
  switch (ext) {
    case "md": return "📝";
    case "pdf": return "📄";
    case "docx": return "📃";
    case "pptx": return "📊";
    case "hwpx": return "🇰🇷";
    case "json": case "yaml": case "yml": case "toml": return "⚙️";
    case "ts": case "js": case "py": case "sh": case "sql": return "💻";
    case "csv": return "📈";
    case "html": case "xml": return "🌐";
    case "jpg": case "jpeg": case "png": case "gif": case "webp": return "🖼️";
    default: return "📄";
  }
}
