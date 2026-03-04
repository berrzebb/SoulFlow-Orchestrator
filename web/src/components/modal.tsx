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

/** form 전용 모달 — onSubmit 핸들러를 래핑하고 Save/Cancel 푸터 제공 */
interface FormModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel?: string;
  saving?: boolean;
  wide?: boolean;
}

export function FormModal({ open, title, children, onClose, onSubmit, submitLabel, saving, wide }: FormModalProps) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? " modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("common.close_modal")}>✕</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal__body modal__form-body">{children}</div>
          <div className="modal__footer">
            <button type="button" className="btn btn--sm" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn--sm btn--accent" disabled={saving}>
              {saving ? t("common.saving") : submitLabel || t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
