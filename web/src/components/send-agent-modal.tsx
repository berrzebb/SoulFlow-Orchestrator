import { useState } from "react";
import { Modal } from "./modal";
import { useT } from "../i18n";

interface Props {
  agentId: string | null;
  onClose: () => void;
  onSend: (agentId: string, text: string) => void;
}

export function SendAgentModal({ agentId, onClose, onSend }: Props) {
  const [text, setText] = useState("");
  const t = useT();

  const submit = () => {
    if (!agentId || !text.trim()) return;
    onSend(agentId, text.trim());
    setText("");
  };

  return (
    <Modal
      open={!!agentId}
      title={t("agents.send_to", { id: agentId?.slice(0, 16) ?? "" })}
      onClose={() => { onClose(); setText(""); }}
      onConfirm={submit}
      confirmLabel={t("common.send")}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={t("agents.message_placeholder")}
        style={{
          width: "100%", background: "var(--bg)", color: "var(--text)",
          border: "1px solid var(--line)", padding: "8px 12px",
          fontFamily: "inherit", fontSize: 12, borderRadius: 4,
        }}
      />
    </Modal>
  );
}
