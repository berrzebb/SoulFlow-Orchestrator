import type { ReactNode } from "react";

/**
 * aria-description 지원 컴포넌트 — 브라우저 미지원 대체 수단.
 *
 * 마우스 호버 + 키보드 포커스 시 모두 보이는 설명 텍스트.
 * 스크린 리더도 읽을 수 있도록 aria-describedby로 연결.
 *
 * 사용:
 * <AriaDescription id="btn-help" text="Ctrl+Enter로 전송">
 *   <button aria-describedby="btn-help">전송</button>
 * </AriaDescription>
 */
export function AriaDescription({
  id,
  text,
  children,
}: {
  id: string;
  text: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="aria-description-wrapper">
      {typeof children === "string" ? (
        <span>{children}</span>
      ) : (
        children
      )}
      <span
        id={id}
        className="aria-description"
        role="tooltip"
        aria-hidden="false"
      >
        {text}
      </span>
    </div>
  );
}
