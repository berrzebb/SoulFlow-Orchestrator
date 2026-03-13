import { ReactNode } from "react";
import { Badge } from "./badge";
import { useT } from "../i18n";
import { useTestMutation } from "../hooks/use-test-mutation";

export interface ResourceCardProps {
  /** 리소스 고유 ID (접근성/key용) */
  resourceId: string;

  /** 카드 제목 (메인 텍스트) */
  title: string;

  /** 카드 부제목 (secondary 텍스트, 회색) */
  subtitle?: string;

  /** 상태 스타일 클래스: "ok" | "warn" | "off" | "err" */
  statusVariant?: "ok" | "warn" | "off" | "err";

  /** 상태 라벨 텍스트 */
  statusLabel?: string;

  /** 배지 목록 (header에 표시) */
  badges?: Array<{
    label: string;
    variant: "info" | "ok" | "warn" | "err" | "off";
  }>;

  /** 테스트 가능 여부 + API URL */
  testUrl?: string;

  /** 테스트 성공/실패 메시지 콜백 */
  onTestSuccess?: (detail: string) => string;
  onTestFail?: (error: string) => string;

  /** Edit 버튼 클릭 (생략 시 편집 버튼 숨김) */
  onEdit?: () => void;

  /** Remove 버튼 클릭 (생략 시 삭제 버튼 숨김) */
  onRemove?: () => void;

  /** 카드 본문에 추가 콘텐츠 (extra/tags 영역) */
  children?: ReactNode;

  /** 추가 CSS 클래스 */
  className?: string;

  /** 버튼 disable 상태 */
  disabled?: boolean;

  /** action bar에 추가 버튼 삽입 (Edit 앞에 렌더링) */
  extraActions?: ReactNode;
}

/**
 * 리소스 카드 컴포넌트
 *
 * 프로바이더, 채널, OAuth 등 리소스 정보를 카드 형태로 표시합니다.
 * stat-card 스타일 기반이며, 테스트, 편집, 삭제 기능을 지원합니다.
 *
 * @example
 * <ResourceCard
 *   resourceId="channel-123"
 *   title="Slack Channel"
 *   subtitle="slack-prod"
 *   statusVariant="ok"
 *   statusLabel="Connected"
 *   badges={[{ label: "Slack", variant: "info" }]}
 *   testUrl="/api/channels/channel-123/test"
 *   onEdit={() => { ... }}
 *   onRemove={() => { ... }}
 * >
 *   <div className="stat-card__extra">
 *     Token: Configured ✓
 *   </div>
 * </ResourceCard>
 */
export function ResourceCard({
  resourceId,
  title,
  subtitle,
  statusVariant = "ok",
  statusLabel,
  badges,
  testUrl,
  onTestSuccess,
  onTestFail,
  onEdit,
  onRemove,
  children,
  className,
  disabled,
  extraActions,
}: ResourceCardProps) {
  const t = useT();

  const { testing, testResult, test } = useTestMutation({
    url: testUrl || "",
    onOk: (r) => onTestSuccess?.(r.detail ?? "") ?? (r.detail ?? t("common.test_passed")),
    onFail: (r) => onTestFail?.(r.error ?? "") ?? (r.error ?? t("common.test_failed")),
    onError: () => t("common.test_failed"),
  });

  return (
    <div
      className={`stat-card desk--${statusVariant}${className ? ` ${className}` : ""}`}
      data-testid={`resource-card-${resourceId}`}
    >
      {/* Header with badges */}
      {(statusLabel || badges?.length) && (
        <div className="stat-card__header stat-card__header--wrap">
          {statusLabel && <Badge status={statusLabel} variant={statusVariant} />}
          {badges?.map((badge) => (
            <Badge key={badge.label} status={badge.label} variant={badge.variant} />
          ))}
        </div>
      )}

      {/* Title */}
      <div className="stat-card__value stat-card__value--md">{title}</div>

      {/* Subtitle */}
      {subtitle && <div className="stat-card__label">{subtitle}</div>}

      {/* Extra content (passed as children) */}
      {children}

      {/* Test result (if available) */}
      {testResult && (
        <div className="stat-card__tags">
          <Badge
            status={testResult.ok ? t("common.pass") : t("common.fail")}
            variant={testResult.ok ? "ok" : "err"}
          />
          <span>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="stat-card__actions">
        {extraActions}
        {onEdit && (
          <button
            className="btn btn--xs"
            onClick={onEdit}
            disabled={disabled}
            aria-label={t("common.edit")}
          >
            {t("common.edit")}
          </button>
        )}

        {testUrl && (
          <button
            className="btn btn--xs btn--ok"
            onClick={() => test()}
            disabled={disabled || testing}
            aria-label={t("common.test")}
          >
            {testing ? t("common.testing") : t("common.test")}
          </button>
        )}

        {onRemove && (
          <button
            className="btn btn--xs btn--danger"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t("common.remove")}
          >
            {t("common.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
