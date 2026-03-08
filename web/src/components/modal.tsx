import { useState, useEffect, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

/** body 스크롤 락 + Esc 키 바인딩 + 포커스 복구 */
export function useModalEffects(open: boolean, onClose: () => void) {
  const prevFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // 이전 포커스 저장
    prevFocusRef.current = document.activeElement as HTMLElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handle);
      // 모달 종료 시 이전 포커스 복구
      prevFocusRef.current?.focus();
    };
  }, [open, onClose]);
}

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  danger?: boolean;
  submitDisabled?: boolean;
}

export function Modal({ open, title, children, onClose, onConfirm, confirmLabel, danger, submitDisabled }: Props) {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);
  useModalEffects(open, onClose);
  useEffect(() => {
    if (!open) return;
    // 첫 입력 가능한 요소로 포커스 이동
    const focusableElements = modalRef.current?.querySelectorAll(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements?.length) {
      const firstElement = focusableElements[0] as HTMLElement;
      firstElement.focus();
      // 모바일: 포커스된 입력 필드가 키보드 뒤에 숨기지 않도록 자동 스크롤
      if (/mobile|android|iphone/i.test(navigator.userAgent)) {
        setTimeout(() => firstElement.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
      }
    } else {
      modalRef.current?.focus();
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={danger ? undefined : onClose}>
      <div className="modal" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("common.close_modal")}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
        {onConfirm && (
          <div className="modal__footer">
            <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
            <button className={`btn ${danger ? "btn--danger" : "btn--ok"}`} onClick={onConfirm} disabled={submitDisabled}>
              {confirmLabel || t("common.confirm")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** window.confirm 대체 훅 — 커스텀 모달 기반 확인 다이얼로그. */
export function useConfirm(): {
  confirm: (message: string, onOk: () => void) => void;
  dialog: ReactNode;
} {
  const [state, setState] = useState<{ message: string; onOk: () => void } | null>(null);
  const confirm = (message: string, onOk: () => void) => setState({ message, onOk });
  const close = () => setState(null);
  const dialog = (
    <Modal
      open={!!state}
      title=""
      onClose={close}
      onConfirm={() => { state?.onOk(); close(); }}
      danger
    >
      <p>{state?.message}</p>
    </Modal>
  );
  return { confirm, dialog };
}

/** 삭제/취소 확인 전용 모달 — danger 스타일 고정. */
export function DeleteConfirmModal({ open, title, message, onClose, onConfirm, confirmLabel }: {
  open: boolean;
  title: string;
  message: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <Modal open={open} title={title} danger onClose={onClose} onConfirm={onConfirm} confirmLabel={confirmLabel}>
      <p className="text-sm">{message}</p>
    </Modal>
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
  submitDisabled?: boolean; // 변경사항 없음 등 추가 비활성화 조건
  wide?: boolean;
}

export function FormModal({ open, title, children, onClose, onSubmit, submitLabel, saving, submitDisabled, wide }: FormModalProps) {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);
  useModalEffects(open, onClose);
  useEffect(() => {
    if (!open) return;
    // 첫 입력 가능한 요소로 포커스 이동
    const focusableElements = modalRef.current?.querySelectorAll(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements?.length) {
      const firstElement = focusableElements[0] as HTMLElement;
      firstElement.focus();
      // 모바일: 포커스된 입력 필드가 키보드 뒤에 숨기지 않도록 자동 스크롤
      if (/mobile|android|iphone/i.test(navigator.userAgent)) {
        setTimeout(() => firstElement.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
      }
    } else {
      modalRef.current?.focus();
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className={`modal${wide ? " modal--wide" : ""}`} ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={saving ? undefined : onClose} disabled={saving} aria-label={t("common.close_modal")}>✕</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal__body modal__form-body">{children}</div>
          <div className="modal__footer">
            <button type="button" className="btn btn--sm" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn--sm btn--accent" disabled={saving || submitDisabled}>
              {saving ? t("common.saving") : submitLabel || t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
