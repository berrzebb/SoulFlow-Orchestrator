# 설계: Chat NDJSON 스트리밍

> **상태**: 구현 완료

## 개요

Web Chat UI의 스트리밍 응답을 기존 글로벌 SSE에서 **세션별 NDJSON HTTP 스트림**으로 개선한다.
Fetch ReadableStream 기반으로 탭 전환 시 버퍼링, 세션별 독립 연결, delta 기반 전송을 지원한다.

## 기존 방식과의 비교

| | 기존 (SSE 글로벌) | **개선 (NDJSON 로컬)** |
|---|---|---|
| 전송 채널 | `/api/sse` 전역 이벤트 | `/messages/stream` 세션 전용 |
| 콘텐츠 단위 | 누적 전체 (`content`) | delta만 전송 (`content.slice(offset)`) |
| 탭 전환 | 계속 렌더링 (낭비) | 버퍼링 후 복귀 시 일괄 적용 |
| 연결 범위 | 모든 클라이언트 공유 | 해당 세션 요청자만 |
| 취소 | 불가 | `AbortController` |
| Fallback | — | SSE `web_stream` (다른 세션 또는 미지원 시) |

## 서버 아키텍처

```
POST /api/chat/sessions/:id/messages/stream
          │
          ├─ add_stream_listener(session_id, fn)  ← 발행 전에 등록 (delta 유실 방지)
          │
          ├─ bus.publish_inbound(...)
          │
          └─ SseManager.broadcast_web_stream(chat_id, content, done)
                  │
                  └─ delta = content.slice(offset)
                     fn(delta, done)  →  res.write(JSON)
```

### NDJSON 이벤트 타입

```jsonc
{ "type": "start" }                        // 메시지 수신 확인
{ "type": "delta", "content": "안녕" }     // 스트리밍 delta
{ "type": "done" }                          // 스트림 완료
{ "type": "error", "error": "timeout" }    // 오류 (타임아웃 2분, 발행 실패)
```

### 핵심 파일

| 파일 | 역할 |
|---|---|
| `src/dashboard/sse-manager.ts` | `stream_listeners` Map, delta 계산, `add_stream_listener()` |
| `src/dashboard/broadcaster.ts` | `SseBroadcasterLike`에 선택적 `add_stream_listener?` 추가 |
| `src/dashboard/route-context.ts` | `RouteContext`에 `add_stream_listener` 필드 추가 |
| `src/dashboard/service.ts` | `_build_route_context`에서 `this._sse.add_stream_listener` 바인딩 |
| `src/dashboard/routes/chat.ts` | `POST .../messages/stream` 엔드포인트 |

## 프론트엔드 아키텍처

### useNdjsonStream 훅

```typescript
const { stream, start, cancel } = useNdjsonStream();
// stream: { chat_id, content, done } | null
// start(chat_id, body): Promise<void>  — 스트림 완료 시 resolve
// cancel(): void                        — AbortController 취소
```

**탭 가시성 버퍼링:**
- `document.visibilityState === "hidden"` → delta를 `buffer_ref`에 누적
- `visibilitychange` 이벤트로 탭 복귀 감지 → 버퍼 한번에 flush

### chat.tsx 스트림 우선순위

```typescript
const active_stream =
  ndjson_stream?.chat_id === activeId ? ndjson_stream    // 1순위: NDJSON 로컬
  : web_stream?.chat_id === activeId ? web_stream        // 2순위: SSE 글로벌 (fallback)
  : null;
```

### 생명주기

```
send() 호출
  → start_stream(chat_id, body)  // fire-and-forget, setSending(false) 즉시
  → NDJSON delta 수신 → virtual_msg로 실시간 렌더링
  → type:"done" 수신 → stream.done = true
  → qc.invalidateQueries(["chat-session", id])  // refetch
  → activeSession.messages에 assistant 메시지 도착
  → cancel_stream()  // 중복 방지, 가상 메시지 제거
```

## 설계 결정사항

- **리스너 등록 순서**: 메시지 발행(`bus.publish_inbound`) *전에* `add_stream_listener` 등록. 에이전트가 빠르게 응답할 경우 초기 delta를 놓치지 않기 위함.
- **SSE fallback 유지**: `web_stream` 글로벌 스토어는 그대로 유지. Mirror 세션, NDJSON 미지원 채널 등에서 계속 동작.
- **타임아웃**: 2분(120초). 에이전트 응답이 없으면 `type:"error"` 후 연결 종료.
- **Content-Type**: `application/x-ndjson; charset=utf-8` — 줄 단위 JSON 스트림 명시.
