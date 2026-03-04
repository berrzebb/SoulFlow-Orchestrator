import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { get_mime_type, MediaTokenStore } from "@src/dashboard/media-store.ts";
import { make_mock_response } from "@helpers/mock-response.ts";

describe("get_mime_type", () => {
  it("알려진 확장자의 MIME 타입을 반환한다", () => {
    expect(get_mime_type(".html")).toBe("text/html");
    expect(get_mime_type(".png")).toBe("image/png");
    expect(get_mime_type(".json")).toBe("application/json");
    expect(get_mime_type(".pdf")).toBe("application/pdf");
    expect(get_mime_type(".mp4")).toBe("video/mp4");
    expect(get_mime_type(".xlsx")).toContain("spreadsheetml");
  });

  it("알 수 없는 확장자는 octet-stream을 반환한다", () => {
    expect(get_mime_type(".xyz")).toBe("application/octet-stream");
    expect(get_mime_type(".unknown")).toBe("application/octet-stream");
  });

  it("빈 문자열은 octet-stream을 반환한다", () => {
    expect(get_mime_type("")).toBe("application/octet-stream");
  });
});

describe("MediaTokenStore", () => {
  let workspace: string;
  let store: MediaTokenStore;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "media-test-"));
    store = new MediaTokenStore(workspace);
    await writeFile(join(workspace, "test.txt"), "hello world");
    await writeFile(join(workspace, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  describe("is_within_workspace", () => {
    it("workspace 내부 경로는 true", () => {
      expect(store.is_within_workspace(join(workspace, "test.txt"))).toBe(true);
      expect(store.is_within_workspace(join(workspace, "sub", "file.md"))).toBe(true);
    });

    it("경로 순회를 차단한다", () => {
      expect(store.is_within_workspace(resolve(workspace, "..", "etc", "passwd"))).toBe(false);
    });

    it("workspace 외부 절대 경로는 false", () => {
      const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
      expect(store.is_within_workspace(outside)).toBe(false);
    });

    it("workspace 자체는 true", () => {
      expect(store.is_within_workspace(workspace)).toBe(true);
    });
  });

  describe("register", () => {
    it("workspace 내부 파일은 토큰을 반환한다", () => {
      const token = store.register(join(workspace, "test.txt"));
      expect(token).toBeTypeOf("string");
      expect(token!.length).toBeGreaterThan(0);
    });

    it("workspace 외부 파일은 null을 반환한다", () => {
      const outside = process.platform === "win32" ? "C:\\Windows\\file.txt" : "/tmp/outside.txt";
      expect(store.register(outside)).toBeNull();
    });

    it("여러 파일을 등록하면 서로 다른 토큰을 반환한다", () => {
      const t1 = store.register(join(workspace, "test.txt"));
      const t2 = store.register(join(workspace, "image.png"));
      expect(t1).not.toBe(t2);
    });
  });

  describe("serve", () => {
    it("유효한 토큰으로 파일을 서빙한다", async () => {
      const token = store.register(join(workspace, "test.txt"))!;
      const res = make_mock_response();
      await store.serve(token, res as any);
      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
      expect(res.end).toHaveBeenCalled();
    });

    it("존재하지 않는 토큰은 404를 반환한다", async () => {
      const res = make_mock_response();
      await store.serve("nonexistent-token", res as any);
      expect(res.statusCode).toBe(404);
      expect(res.end).toHaveBeenCalledWith("not_found");
    });

    it("만료된 토큰은 404를 반환한다", async () => {
      const token = store.register(join(workspace, "test.txt"))!;
      const orig = Date.now;
      Date.now = () => orig.call(Date) + 3_600_001;
      try {
        const res = make_mock_response();
        await store.serve(token, res as any);
        expect(res.statusCode).toBe(404);
      } finally {
        Date.now = orig;
      }
    });

    it("파일 읽기 실패 시 404를 반환한다", async () => {
      const token = store.register(join(workspace, "nonexistent-file.txt"))!;
      const res = make_mock_response();
      await store.serve(token, res as any);
      expect(res.statusCode).toBe(404);
    });
  });
});
