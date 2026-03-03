import type { ReactNode } from "react";
import { useT } from "../i18n";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  danger?: boolean;
}

export function Modal({ open, title, children, onClose, onConfirm, confirmLabel, danger }: Props) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("common.close_modal")}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
        {onConfirm && (
          <div className="modal__footer">
            <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
            <button className={`btn ${danger ? "btn--danger" : "btn--ok"}`} onClick={onConfirm}>
              {confirmLabel || t("common.confirm")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
