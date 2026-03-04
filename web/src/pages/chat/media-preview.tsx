import { useT } from "../../i18n";
import type { ChatMediaItem } from "./types";

export function MediaDisplay({ media }: { media: ChatMediaItem[] }) {
  return (
    <div className="chat-media">
      {media.map((m, i) => {
        const is_image = m.type === "image" || (m.mime ?? "").startsWith("image/");
        if (is_image && m.url) {
          return (
            <img
              key={i}
              src={m.url}
              alt={m.name ?? "image"}
              className="chat-media__img"
              onClick={() => window.open(m.url, "_blank")}
              title={m.name ?? "image"}
            />
          );
        }
        return (
          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="chat-media__file">
            📎 {m.name ?? m.type}
          </a>
        );
      })}
    </div>
  );
}

export function MediaPreviewBar({ items, onRemove }: { items: ChatMediaItem[]; onRemove: (idx: number) => void }) {
  const t = useT();
  if (!items.length) return null;

  return (
    <div className="chat-media-preview">
      {items.map((m, i) => {
        const is_image = m.type === "image" || (m.mime ?? "").startsWith("image/");
        return (
          <div key={i} className="chat-media-preview__item">
            {is_image ? (
              <img src={m.url} alt={m.name ?? ""} />
            ) : (
              <div className="chat-media-preview__file">
                📎{m.name ? `\n${m.name.slice(0, 12)}` : ""}
              </div>
            )}
            <button
              className="chat-media-preview__remove"
              onClick={() => onRemove(i)}
              title={t("chat.remove_attachment")}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
