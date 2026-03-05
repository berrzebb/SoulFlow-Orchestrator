# 설계: Container Code Runner — 다중 언어 컨테이너 샌드박스 코드 실행

> **상태**: 구현 완료

## 개요

Code 노드를 JavaScript/Shell 전용에서 **7개 언어** (Python, Ruby, Bash, Go, Rust, Deno, Bun)로 확장.
podman/docker 컨테이너에서 one-shot 또는 persistent 모드로 샌드박스 실행.

## 문제

기존 Code 노드는 `vm` 모듈(JavaScript)과 `child_process`(Shell)만 지원.
Python 데이터 처리, Go 성능 로직 등을 워크플로우에서 직접 실행할 수 없었음.
컨테이너 PTY 인프라는 이미 존재하므로 이를 활용한 언어 불문 샌드박스 실행이 가능.

## 아키텍처

### 3가지 실행 경로

```
Code Node (code.ts)
├── language: "javascript"  → vm sandbox (기존)
├── language: "shell"       → child_process (기존)
└── language: python|ruby|bash|go|rust|deno|bun
    → container-code-runner.ts
    → podman/docker run --rm (one-shot)
    → 또는 named container + exec (persistent)
```

### 보안 제약

| 제약 | 값 |
|------|---|
| 네트워크 | `--network=none` (기본, 옵트인으로 허용) |
| 파일시스템 | `--read-only` + `/tmp` tmpfs (64MB) |
| 메모리 | `--memory=256m` |
| CPU | `--cpus=1` |
| 워크스페이스 | `-v workspace:/workspace:ro` (읽기 전용) |
| 코드 마운트 | `-v tmpdir:/code:ro` |

### 런타임 매핑

| 언어 | 이미지 | 확장자 | 실행 명령 |
|------|--------|--------|----------|
| python | `python:3.12-slim` | `.py` | `python3 script.py` |
| ruby | `ruby:3.3-slim` | `.rb` | `ruby script.rb` |
| bash | `bash:5` | `.sh` | `bash script.sh` |
| go | `golang:1.22-alpine` | `.go` | `go run script.go` |
| rust | `rust:1.77-slim` | `.rs` | `rustc script.rs -o /tmp/out && /tmp/out` |
| deno | `denoland/deno:2.0` | `.ts` | `deno run --allow-all script.ts` |
| bun | `oven/bun:1` | `.ts` | `bun run script.ts` |

### 실행 모드

**One-shot** (`keep_container: false`, 기본):
```
podman run --rm --network=none --memory=256m ... python:3.12-slim python3 /code/script.py
```

**Persistent** (`keep_container: true`):
```
podman run -d --name code-xxx ... python:3.12-slim sleep 3600
podman exec code-xxx python3 /code/script.py
```
동일 컨테이너 재사용으로 이미지 pull + 초기화 비용 절감.

### 컨테이너 엔진 감지

podman → docker 순으로 자동 감지, 결과 캐싱. 둘 다 없으면 에러.

## 타입 확장

```typescript
// workflow-node.types.ts
type CodeLanguage =
  | "javascript" | "shell"
  | "python" | "ruby" | "bash" | "go" | "rust" | "deno" | "bun";

interface CodeNodeDefinition extends NodeBase {
  node_type: "code";
  language: CodeLanguage;
  code: string;
  timeout_ms?: number;
  container_image?: string;   // 이미지 오버라이드
  network_access?: boolean;   // 네트워크 허용
  keep_container?: boolean;   // 컨테이너 유지
}
```

## 파일 구조

```
src/agent/
  workflow-node.types.ts       # CodeLanguage 확장, CodeNodeDefinition
  nodes/
    code.ts                    # 3 실행 경로 분기 (JS/Shell/Container)
    container-code-runner.ts   # 컨테이너 실행 엔진

web/src/pages/workflows/
  nodes/code.tsx               # 9개 언어 선택 + 컨테이너 옵션 UI
```

## 관련 문서

→ [Node Registry](./node-registry.md) — 27개 노드 등록 아키텍처
→ [PTY 에이전트 백엔드](./pty-agent-backend.md) — 컨테이너 인프라
