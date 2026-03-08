import type { ReactNode } from "react";

/** 페이지/섹션 헤더 — 제목 + 우측 액션 영역. */
export function SectionHeader({ title, children, className, titleClassName }: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div className={`section-header${className ? ` ${className}` : ""}`}>
      <h2 className={titleClassName}>{title}</h2>
      {children}
    </div>
  );
}
