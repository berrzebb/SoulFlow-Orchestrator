import { useT } from "../../i18n";

export function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  const t = useT();
  return (
    <div className="chat-empty">
      <div className="chat-empty__icon">💬</div>
      <div className="chat-empty__title">{t("chat.welcome_title")}</div>
      <div className="chat-empty__subtitle">{t("chat.welcome_subtitle")}</div>
      <button className="btn btn--ok" onClick={() => void onNewSession()}>
        {t("chat.new_session")}
      </button>
    </div>
  );
}
