# 보안 강화 (Security Improvements)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 현재 코드에서 보안을 강화할 수 있는 6건의 개선 항목을 기록한다.
각 항목은 현재 상태가 "취약"한 것이 아니라 "더 강화할 수 있다"는 관점이다.

현재 보안 등급: **8/10 (B+)**

이미 잘 되어 있는 것:
- AES-256-GCM + AAD의 프로덕션 수준 Secret Vault
- 파일 핸들러의 경로 순회(path traversal) 검증
- 셸 핸들러의 위험 명령어 차단
- ESLint `no-explicit-any` 에러 레벨
- Zod 기반 설정 스키마 검증

---

## S1: Slack 타임스탬프 범위 검증

### 위치

`src/channels/slack.channel.ts`

### 현재 상태

```typescript
function is_valid_slack_ts(ts: string): boolean {
  return /^\d+\.\d+$/.test(ts); // 형식만 검증
}
```

`9223372036854775807.999999` 같은 극단값이 통과한다.
타임스탬프 비교 연산에서 예기치 않은 동작을 일으킬 수 있다.

### 구현 계획

```typescript
function is_valid_slack_ts(ts: string): boolean {
  if (!/^\d+\.\d+$/.test(ts)) return false;
  const [sec] = ts.split(".");
  const sec_num = Number(sec);
  return sec_num > 1_000_000_000 && sec_num < 2_000_000_000;
}
```

### 분리 방법

변경이 1개 함수에 국한되므로 별도 분리 불필요.
기존 파일 내에서 수정한다.

### 예상 변경 범위

- `src/channels/slack.channel.ts` (1개 함수)
- 테스트 추가

---

## S2: 채널별 파일 경로 검증 통합

### 위치

- `src/channels/slack.channel.ts`
- `src/channels/discord.channel.ts`
- `src/channels/telegram.channel.ts`

### 현재 상태

채널에서 `media.url`로 전달되는 파일 경로에 대한 검증이 누락되어 있다.
`readFile()` 호출 시 사용자가 제공한 경로가 그대로 사용될 수 있다.

파일 핸들러(`src/agent/nodes/file.ts`)에는 경로 순회 검증이 있지만, 채널 레이어에는 없다.

### 구현 계획

#### 단계 1: 공유 경로 검증 유틸 생성

```typescript
// src/utils/path-validation.ts
import { resolve } from "node:path";

export function validate_file_path(
  file_path: string,
  allowed_dirs: string[],
): boolean {
  const resolved = resolve(file_path);
  return allowed_dirs.some(dir => resolved.startsWith(resolve(dir)));
}
```

#### 단계 2: 채널에서 파일 접근 시 검증 적용

```typescript
// 각 채널의 readFile 호출 전
if (!validate_file_path(media.url, [workspace_dir, temp_dir])) {
  return { ok: false, error: "path_traversal_blocked" };
}
```

### 분리 방법

새 유틸 파일 `src/utils/path-validation.ts`를 생성한다.
각 채널 파일에서 import하여 사용한다.

### 예상 변경 범위

- `src/utils/path-validation.ts` (신규)
- `src/channels/slack.channel.ts`
- `src/channels/discord.channel.ts`
- `src/channels/telegram.channel.ts`
- 테스트 추가

---

## S3: Telegram HTML 콘텐츠 이스케이프

### 위치

`src/channels/telegram.channel.ts`

### 현재 상태

`parse_mode="HTML"` 설정 시 사용자 입력의 `<b>`, `<code>` 등이 마크업으로 해석될 수 있다.

### 구현 계획

```typescript
function escape_telegram_html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

사용자 입력이 포함되는 위치에서만 적용한다.
시스템이 생성하는 의도적 마크업에는 적용하지 않는다.

### 분리 방법

이스케이프 함수는 `src/channels/telegram.channel.ts` 내부에 둔다.
범용성이 확인되면 `src/utils/html-strip.ts`로 이동한다.

### 예상 변경 범위

- `src/channels/telegram.channel.ts` (함수 추가 + 적용)
- 테스트 추가

---

## S4: 설정 경로 절대 경로 검증

### 위치

`src/config/schema.ts`

### 현재 상태

`dataDir`와 `workspaceDir` 설정에 상대 경로가 허용된다.
상대 경로가 `cwd` 변경에 따라 예기치 않은 위치를 가리킬 수 있다.

### 구현 계획

```typescript
const PathSchema = z.string().refine(
  (p) => path.isAbsolute(p),
  { message: "absolute path required" }
);
```

또는 상대 경로를 자동 해석하는 방식으로 대응한다.

```typescript
const resolved = path.resolve(config.dataDir);
```

### 분리 방법

Zod 스키마에 `.refine()` 추가. 별도 분리 불필요.

### 예상 변경 범위

- `src/config/schema.ts` (스키마 수정)
- 테스트 추가

---

## S5: 셸 핸들러 작업 디렉토리 검증

### 위치

`src/agent/nodes/shell.ts`

### 현재 상태

셸 핸들러에 위험 명령어 차단(`BLOCKED_PATTERNS`)은 있지만, `working_dir` 옵션에 대한 경로 순회 검증이 없다.

파일 핸들러(`file.ts`)에는 경로 순회 검증이 있다.

```typescript
// file.ts — 있음
if (norm !== ws && !norm.startsWith(`${ws}/`) && !norm.startsWith(`${ws}\\`)) {
  throw new Error("path traversal not allowed");
}

// shell.ts — 없음
const result = execSync(command, { cwd: working_dir, ... });
```

### 구현 계획

```typescript
// shell.ts
if (working_dir) {
  const norm = path.resolve(working_dir);
  const ws = path.resolve(workspace_dir);
  if (!norm.startsWith(ws)) {
    return { output: { error: "working_dir path traversal blocked" } };
  }
}
```

### 분리 방법

기존 파일 내 수정. S2의 공유 유틸이 만들어지면 그것을 사용한다.

### 예상 변경 범위

- `src/agent/nodes/shell.ts` (검증 추가)
- 테스트 추가

---

## S6: HTTP 요청 타임아웃 설정 가능화

### 위치

`src/bootstrap/orchestration.ts`

### 현재 상태

HTTP 요청 타임아웃이 코드에 고정되어 있다.
외부 서비스 응답이 느린 환경에서 조정이 불가능하다.

### 구현 계획

설정 스키마에 타임아웃 필드를 추가한다.

```typescript
// config/schema.ts
const OrchestrationSchema = z.object({
  httpTimeoutMs: z.number().min(1000).max(120_000).default(15_000),
});
```

부트스트랩에서 설정값을 주입한다.

### 분리 방법

설정 스키마 확장 + 부트스트랩 주입. 기존 파일 내 수정.

### 예상 변경 범위

- `src/config/schema.ts` (필드 추가)
- `src/bootstrap/orchestration.ts` (설정값 사용)
- 테스트 추가

---

## 진행 상태

| 항목 | 우선순위 | 상태 |
|------|----------|------|
| S1: Slack 타임스탬프 | 중 | 미착수 |
| S2: 파일 경로 검증 | 중 | 미착수 |
| S3: Telegram HTML | 중 | 미착수 |
| S4: 경로 절대 검증 | 저 | 미착수 |
| S5: 셸 작업 디렉토리 | 중 | 미착수 |
| S6: HTTP 타임아웃 | 저 | 미착수 |
