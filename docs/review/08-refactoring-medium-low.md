# 중간/낮은 효과 리팩토링 (Medium/Low Impact Refactoring)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 코드 품질과 유지보수성에 중간~낮은 효과를 가져올 수 있는 리팩토링 7건(R5–R11)을 기록한다.
각 항목에 대해 현재 문제, 코드 분리 설계, 구현 계획을 포함한다.

---

## R5: 채널별 메시지 타입 정의

### 현재 문제

모든 채널이 `Record<string, unknown>`으로 원시 메시지를 처리한다.
(Medium Issue M1과 연관)

```typescript
// 3개 채널에서 반복
function to_inbound_message(channel: SlackChannel, raw: Record<string, unknown>, chat_id: string): InboundMessage
```

### 코드 분리 설계

#### 목표 구조

```
src/channels/
├── slack.types.ts             ← 신규
├── discord.types.ts           ← 신규
├── telegram.types.ts          ← 신규
├── slack.channel.ts           ← 수정: 전용 타입 사용
├── discord.channel.ts         ← 수정: 전용 타입 사용
└── telegram.channel.ts        ← 수정: 전용 타입 사용
```

#### 타입 설계

```typescript
// src/channels/slack.types.ts
export interface SlackRawMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  files?: SlackFile[];
  blocks?: unknown[];
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private?: string;
  size?: number;
}

export interface SlackApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}
```

```typescript
// src/channels/telegram.types.ts
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
}
```

### 구현 계획

#### 단계 1: 타입 파일 생성

각 채널 API 문서를 참조하여 타입을 정의한다.
완전한 타입이 아닌, 실제로 사용하는 필드만 포함한다.

#### 단계 2: 점진적 교체

한 채널씩 `Record<string, unknown>`을 전용 타입으로 교체한다.
1. Slack (가장 사용량이 많음)
2. Telegram
3. Discord

#### 단계 3: to_inbound_message 타입 업데이트

```typescript
// 변경 전
function to_inbound_message(channel: SlackChannel, raw: Record<string, unknown>, chat_id: string): InboundMessage

// 변경 후
function to_inbound_message(channel: SlackChannel, raw: SlackRawMessage, chat_id: string): InboundMessage
```

### 금지 사항

- 기존 `Record<string, unknown>` 타입의 값을 런타임에서 거부하지 않는다
- API 응답 형태가 변경되었을 때 컴파일 에러가 나도록 `unknown` 필드를 남긴다

### 완료 기준

- 채널별 전용 타입 파일이 생성됨
- `to_inbound_message`의 `raw` 파라미터가 전용 타입을 사용
- IDE 자동완성이 동작함
- 기존 테스트 통과

### 예상 변경 범위

- `src/channels/slack.types.ts` (신규)
- `src/channels/discord.types.ts` (신규)
- `src/channels/telegram.types.ts` (신규)
- 각 채널 파일 (타입 교체)

---

## R6: 에러 응답 엔벨로프 표준화

### 현재 문제

노드 핸들러마다 에러 응답 형태가 다르다.

```typescript
// 핸들러마다 다른 형태
{ output: { result: "", success: false, error: "msg" } }      // 일반
{ output: { stdout: "", stderr: "", exit_code: 1, error: "msg" } }  // shell
{ output: { approved: false, error: "msg" } }                  // approval
```

### 코드 분리 설계

#### 공통 에러 빌더

```typescript
// src/agent/nodes/_helpers.ts에 추가
export function node_error_output(
  error: unknown,
  extra?: Record<string, unknown>,
): OrcheNodeExecuteResult {
  return {
    output: {
      ...extra,
      error: error_message(error),
      success: false,
    },
  };
}
```

#### 도메인별 에러 빌더

각 핸들러의 도메인별 필드는 유지한다.

```typescript
// shell 핸들러
return node_error_output(err, { stdout: "", stderr: stderr_text, exit_code: 1 });

// approval 핸들러
return node_error_output(err, { approved: false });
```

### 구현 계획

#### 단계 1: 헬퍼 함수 추가

`src/agent/nodes/_helpers.ts`에 `node_error_output()`을 추가한다.
(R2와 같은 파일)

#### 단계 2: 점진적 교체

가장 자주 수정되는 핸들러부터 교체한다.

### 금지 사항

- 기존 output 필드 이름 변경 금지
- 기존 테스트의 output 형태 변경 금지

### 예상 변경 범위

- `src/agent/nodes/_helpers.ts` (함수 추가)
- `src/agent/nodes/*.ts` (점진적 교체)

---

## R7: 타임아웃 상수 중앙화

### 현재 문제

5개 이상의 다른 타임아웃 기본값이 핸들러에 산재한다.

```typescript
n.timeout_ms || 10_000   // http.ts
n.timeout_ms || 30_000   // shell.ts
600_000                  // approval.ts
```

### 코드 분리 설계

```typescript
// src/agent/nodes/_constants.ts (신규)
export const NODE_TIMEOUTS = {
  HTTP: 10_000,
  SHELL: 30_000,
  DATABASE: 30_000,
  APPROVAL: 600_000,
  DEFAULT: 30_000,
} as const;

export const NODE_LIMITS = {
  MAX_OUTPUT_SIZE: 100_000,
  MAX_CONTENT_LENGTH: 50_000,
} as const;
```

### 구현 계획

#### 단계 1: 상수 파일 생성

`src/agent/nodes/_constants.ts`를 생성한다.

#### 단계 2: 핸들러에서 상수 참조

```typescript
// 변경 전
const timeout = n.timeout_ms || 10_000;

// 변경 후
const timeout = n.timeout_ms || NODE_TIMEOUTS.HTTP;
```

### 예상 변경 범위

- `src/agent/nodes/_constants.ts` (신규)
- `src/agent/nodes/*.ts` (상수 참조)

---

## R8: `with_sqlite()` 에러 처리 개선

### 현재 문제

(Observability O3, Critical C4와 연관)

모든 SQLite 에러가 무음으로 `null` 반환된다.

### 코드 분리 설계

```typescript
// src/utils/sqlite-helper.ts에 추가

/**
 * 실패 시 throw하는 strict 변형.
 * 스키마 초기화 등 필수 경로에서 사용한다.
 */
export function with_sqlite_strict<T>(
  db_path: string,
  run: (db: DatabaseSync) => T,
  options?: SqliteRunOptions,
): T {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(db_path);
    if (options?.pragmas) {
      for (const p of options.pragmas) db.pragma(p);
    }
    return run(db);
  } finally {
    try { db?.close(); } catch { /* close 실패 무시 */ }
  }
}
```

### 구현 계획

O3, C4 문서의 계획과 동일.
`with_sqlite_strict()` 추가 → 필수 초기화 경로에서 사용 → 기존 함수에 로깅 추가.

### 예상 변경 범위

- `src/utils/sqlite-helper.ts`

---

## R9: 스킬 시스템 TypeScript 인터페이스 도입

### 현재 문제

현재 스킬 역할은 마크다운 기반 프로토콜로만 정의되어 있다.
런타임 검증이 없어 스킬 메타데이터 오류가 실행 시점까지 발견되지 않는다.

### 코드 분리 설계

```typescript
// src/skills/_shared/types.ts (신규)
export interface SkillMetadata {
  name: string;
  role: string;
  tools: string[];
  shared_protocols: string[];
  description?: string;
}

export interface SkillLoader {
  discover(skill_dir: string): SkillMetadata[];
  validate(metadata: SkillMetadata): { ok: boolean; errors: string[] };
}
```

```typescript
// src/skills/_shared/loader.ts (신규)
export function load_skill_metadata(skill_dir: string): SkillMetadata {
  const skill_md_path = join(skill_dir, "SKILL.md");
  const content = readFileSync(skill_md_path, "utf-8");
  return parse_skill_metadata(content);
}
```

### 구현 계획

#### 단계 1: 인터페이스 정의

`src/skills/_shared/types.ts`에 `SkillMetadata` 인터페이스를 정의한다.

#### 단계 2: 로더 구현

`src/skills/_shared/loader.ts`에 SKILL.md 파서를 구현한다.

#### 단계 3: 부트스트랩에서 검증

서비스 시작 시 모든 스킬 메타데이터를 로드하고 검증한다.

### 예상 변경 범위

- `src/skills/_shared/types.ts` (신규)
- `src/skills/_shared/loader.ts` (신규)
- `src/bootstrap/skills.ts` (검증 추가)

---

## R10: 분류기 한국어 의존성 설정 가능화

### 현재 문제

분류기의 키워드 맵, 임계값이 한국어에 하드코딩되어 있다.
다른 언어 배포 시 분류 정확도가 저하될 수 있다.

### 코드 분리 설계

```typescript
// src/orchestration/classifier-locale.ts (신규)
export interface ClassifierLocale {
  keyword_map: Record<string, string[]>;
  identity_threshold: number;
  inquiry_threshold: number;
  skill_trigger_threshold: number;
  agent_tool_pairs: [string, string][];
  connector_phrases: string[];
}

export const KO_LOCALE: ClassifierLocale = {
  keyword_map: KO_KEYWORD_MAP,
  identity_threshold: 0.4,
  inquiry_threshold: 0.3,
  skill_trigger_threshold: 0.45,
  agent_tool_pairs: [["파일", "보내"], ...],
  connector_phrases: ["하고 나서", "그리고 나서", ...],
};
```

### 구현 계획

#### 단계 1: 로케일 인터페이스 정의

현재 분류기의 하드코딩된 값을 인터페이스로 추출한다.

#### 단계 2: 기본 로케일(KO)로 초기화

기존 동작을 유지하면서 설정 가능한 구조로 변경한다.

#### 단계 3: 설정에서 로케일 선택 가능하게

```typescript
// config/schema.ts
classifierLocale: z.enum(["ko", "en"]).default("ko"),
```

### 예상 변경 범위

- `src/orchestration/classifier-locale.ts` (신규)
- `src/orchestration/classifier.ts` (로케일 주입)
- `src/config/schema.ts` (설정 추가)

---

## R11: progress_relay 재시작 메커니즘

### 현재 문제

```typescript
(async function progress_relay() {
  while (!bus.is_closed()) {
    const event = await bus.consume_progress({ timeout_ms: 5000 });
    if (event) broadcaster.broadcast_progress_event(event);
  }
})().catch((e) => logger.error("[progress_relay] unhandled:", e));
```

fire-and-forget 프로미스에 재시작 로직이 없다.
progress_relay가 예기치 않게 종료되면 진행 이벤트가 영구적으로 누락된다.

### 코드 분리 설계

```typescript
// src/utils/resilient-loop.ts (신규)
export async function resilient_loop(
  name: string,
  fn: () => Promise<void>,
  options: {
    logger: Logger;
    max_restarts?: number;
    restart_delay_ms?: number;
    is_stopped?: () => boolean;
  },
): Promise<void> {
  const max = options.max_restarts ?? 5;
  const delay = options.restart_delay_ms ?? 1000;
  let restarts = 0;

  while (restarts < max && !(options.is_stopped?.())) {
    try {
      await fn();
      return; // 정상 종료
    } catch (e) {
      restarts++;
      options.logger.warn(`${name} failed, restarting (${restarts}/${max})`, {
        error: error_message(e),
      });
      await new Promise(r => setTimeout(r, delay * restarts)); // 선형 백오프
    }
  }
  options.logger.error(`${name} exceeded max restarts (${max})`);
}
```

### 구현 계획

#### 단계 1: resilient_loop 유틸 생성

`src/utils/resilient-loop.ts`를 생성한다.

#### 단계 2: progress_relay에 적용

```typescript
resilient_loop("progress_relay", async () => {
  while (!bus.is_closed()) {
    const event = await bus.consume_progress({ timeout_ms: 5000 });
    if (event) broadcaster.broadcast_progress_event(event);
  }
}, { logger, is_stopped: () => bus.is_closed() });
```

### 예상 변경 범위

- `src/utils/resilient-loop.ts` (신규)
- `src/bootstrap/services.ts` (적용)
- 테스트 추가

---

## 진행 상태

| 항목 | 효과 | 노력 | 상태 |
|------|------|------|------|
| R5: 메시지 타입 | 타입 안전성 향상 | 높 | 미착수 |
| R6: 에러 엔벨로프 | 일관성 향상 | 중 | 미착수 |
| R7: 타임아웃 상수 | 유지보수성 향상 | 저 | 미착수 |
| R8: SQLite 에러 | 관찰 가능성 향상 | 저 | 미착수 |
| R9: 스킬 타입 | 런타임 검증 | 중 | 미착수 |
| R10: 분류기 로케일 | 다국어 지원 | 중 | 미착수 |
| R11: 재시작 메커니즘 | 복원력 향상 | 저 | 미착수 |
