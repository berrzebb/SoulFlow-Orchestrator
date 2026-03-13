/**
 * OB-6: Delivery Trace.
 *
 * 요청 채널과 실제 전달 채널, 전달 상태를 구분해 기록.
 * delivery span의 attributes 확장으로 구현 — 별도 저장소 불필요.
 */
import type { ObservabilityLike } from "./context.js";
import type { CorrelationContext } from "./correlation.js";
import type { SpanHandle } from "./span.js";

export type DeliveryStatus = "sent" | "failed" | "pending";

export type DeliveryTraceAttributes = {
  requested_channel: string;
  delivered_channel: string;
  delivery_status: DeliveryStatus;
  delivery_attempt: number;
  reply_target_chat_id: string;
  reply_target_sender_id: string;
};

/**
 * delivery span을 시작. 반환된 handle로 완료/실패를 기록한다.
 *
 * 사용 패턴:
 *   const h = start_delivery(obs, { ... }, corr);
 *   try { await send(...); finish_delivery(h, obs, "sent"); }
 *   catch { finish_delivery(h, obs, "failed"); throw; }
 */
export function start_delivery(
  obs: ObservabilityLike,
  attrs: Omit<DeliveryTraceAttributes, "delivery_status">,
  correlation: Partial<CorrelationContext>,
): SpanHandle {
  return obs.spans.start("delivery", "send_outbound", correlation, {
    ...attrs,
    delivery_status: "pending" as DeliveryStatus,
  });
}

/** delivery span 완료 + metrics 기록. */
export function finish_delivery(
  handle: SpanHandle,
  obs: ObservabilityLike,
  status: DeliveryStatus,
  duration_ms: number,
): void {
  const attrs = handle.span.attributes as Record<string, unknown>;
  attrs.delivery_status = status;

  if (status === "failed") {
    handle.fail("delivery_failed");
  } else {
    handle.end("ok");
  }

  const requested = String(attrs.requested_channel || "");
  const delivered = String(attrs.delivered_channel || "");
  const mismatch = requested !== delivered ? "true" : "false";

  obs.metrics.counter("delivery_total", 1, { status, channel: delivered, mismatch });
  obs.metrics.histogram("delivery_duration_ms", duration_ms, { channel: delivered });
}
