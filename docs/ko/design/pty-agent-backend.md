# 설계: 컨테이너 기반 에이전트 백엔드

> **상태**: 구현 완료

## 동기

현재 CLI 백엔드(`claude_cli`, `codex_cli`)는 요청마다 프로세스를 생성·종료합니다. 이 방식의 한계:

- **히스토리 리플레이**: 매 요청마다 전체 대화 히스토리를 인자로 전달 → O(n) 비용
- **세션 단절**: 프로세스 종료 시 내부 컨텍스트 소실, `supports_resume = false`
- **에이전트 간 격리**: 같은 사용자 세션 내 에이전트들이 서로의 진행 상황을 알 수 없음

## 핵심 아이디어

**에이전트 하나 = Docker 컨테이너 하나.** `node-pty` 호환 인터페이스로 추상화하여, 상위 레이어는 transport를 모른다.

```
┌──────────────────────────────────────────────────┐
│                  Orchestrator                     │
│                                                   │
│  ┌──────────────┐     ┌────────────────────────┐ │
│  │   Gateway     │────→│    AgentBus (통신)      │ │
│  │ phi-classifier│     │ ask/send/broadcast     │ │
│  └──────────────┘     │ 권한 매트릭스           │ │
│                        │ request/reply 매칭     │ │
│                        └───────────┬────────────┘ │
│                                    │ Pty 인터페이스│
│                        ┌───────────┴────────────┐ │
│                        │  ContainerPool (관리)   │ │
│                        │ spawn/kill/reconcile   │ │
│                        │ resource limits        │ │
│                        └───────────┬────────────┘ │
│                                    │ Docker API    │
│                        ┌───────────┴────────────┐ │
│                        │  Docker Socket Proxy    │ │
│                        └───────────┬────────────┘ │
└────────────────────────────────────┼──────────────┘
                       ┌─────────────┼─────────────┐
                       │             │             │
                  ┌────┴───┐   ┌────┴────┐   ┌───┴──────┐
                  │ butler │   │  impl   │   │ reviewer │
                  │ claude │   │  codex  │   │ claude   │
                  └────────┘   └─────────┘   └──────────┘
```

### 설계 결정

- **Docker 전제**: 항상 Linux 컨테이너에서 실행. Windows에서는 WSL2, 프로덕션은 Docker/K8s.
- **node-pty 호환 인터페이스**: `spawn`/`write`/`onData`/`onExit`/`kill` — 상위 레이어는 Docker를 모른다.
- **통신과 관리의 분리**: AgentBus는 메시지 라우팅, ContainerPool은 컨테이너 생명주기.
- **Gateway**: 경량 분류기(orchestrator LLM)가 메시지를 먼저 분류하여 PTY spawn 또는 Native turn으로 라우팅.

---

## Pty 인터페이스

`node-pty`의 `IPty`와 동일한 인터페이스. 백엔드 구현만 교체 가능.

### spawn

```typescript
function spawn(
  file: string,                  // "claude", "codex"
  args: string[],                // ["--headless", "--session", key, "--output-format", "ndjson"]
  options: {
    name: string;                // 컨테이너명: "agent-slack-C123-butler"
    cols: number;                // 터미널 폭 (headless에서는 참고용)
    rows: number;                // 터미널 높이
    cwd: string;                 // 작업 디렉토리: "/workspace"
    env: Record<string, string>; // 환경변수 (API 키 등)
  }
): Pty;
```

### Pty

```typescript
interface Pty {
  /** 컨테이너 ID 또는 프로세스 ID. */
  readonly pid: string;

  /** 데이터 전송 — Docker attach stdin에 쓰기. */
  write(data: string): void;

  /** 데이터 수신 콜백 — Docker attach stdout에서 읽기. */
  onData: (cb: (data: string) => void) => Disposable;

  /** 종료 이벤트 콜백 — Docker container die 이벤트. */
  onExit: (cb: (e: { exitCode: number }) => void) => Disposable;

  /** 프로세스(컨테이너) 강제 종료. */
  kill(): void;

  /** 터미널 리사이즈. headless에서는 no-op. */
  resize(cols: number, rows: number): void;
}
```

### 구현 매핑

| Pty 메서드 | DockerPty (프로덕션) | LocalPty (개발용) |
|-----------|---------------------|------------------|
| `spawn(file, args, opts)` | `docker create` + `start` + `attach` | `node-pty.spawn()` |
| `write(data)` | attach stdin stream | pty stdin |
| `onData(cb)` | attach stdout stream | pty stdout |
| `onExit(cb)` | Docker events API (die) | SIGCHLD |
| `kill()` | `docker kill` | `process.kill()` |
| `resize(cols, rows)` | no-op (headless) | `pty.resize()` |
| `pid` | container ID | OS PID |

### DockerPty 구현

```typescript
function spawn(file: string, args: string[], options: PtyOptions): Pty {
  const container_id = docker.create({
    name: options.name,
    image: "soulflow/agent-runner:latest",
    cmd: [file, ...args],
    working_dir: options.cwd,
    env: options.env,
    stdin_open: true,
    // 보안 + 리소스
    memory: "512m",
    cpus: 1.0,
    network_mode: "none",
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges"],
    read_only: true,
    tmpfs: { "/tmp": "size=100m" },
    user: "1000:1000",
    pids_limit: 100,
    labels: {
      "sf.session_key": derive_session_key(options.name),
      "sf.cli": file,
    },
  });

  docker.start(container_id);
  const { stdin, stdout } = docker.attach(container_id, { stdin: true, stdout: true });

  return {
    pid: container_id,
    write: (data) => stdin.write(data),
    onData: (cb) => subscribe(stdout, "data", cb),
    onExit: (cb) => subscribe(docker.events(container_id, "die"), cb),
    kill: () => docker.kill(container_id),
    resize: () => {},
  };
}
```

---

## Gateway — 메시지 라우팅

현재 모든 채널 메시지가 동일 경로로 에이전트에 도달한다. Gateway는 경량 분류기(orchestrator LLM)로 메시지를 **먼저 분류**하여 적절한 실행 경로로 라우팅한다.

### 현재 흐름 (직접 연결)

```
Channel → ChannelManager → OrchestrationService → classify → AgentBackend.run()
```

모든 메시지가 OrchestrationService까지 올라간 후에야 분류 발생.

### 제안 흐름 (Gateway 도입)

```
Channel → Gateway → 분류 결정
                      ├─ PTY spawn  → ContainerCliAgent (복잡한 태스크, 멀티턴)
                      ├─ Native turn → ClaudeSdkAgent / OpenAiAgent (단순 질의)
                      └─ Direct reply → 에이전트 없이 즉시 응답 (FAQ, 상태 조회)
```

### Gateway 설계

```typescript
interface GatewayDecision {
  route: "pty_spawn" | "native_turn" | "direct_reply";
  backend_hint?: string;           // "claude_cli", "claude_sdk", ...
  resource_profile?: "light" | "standard" | "heavy";
  direct_content?: string;         // route=direct_reply일 때
}

class Gateway {
  private classifier: PhiClassifier;

  /** 메시지를 분류하여 실행 경로를 결정. */
  async classify(message: InboundMessage, context: SessionContext): Promise<GatewayDecision> {
    // orchestrator LLM 경량 분류: ~100ms
    const mode = await this.classifier.run({
      text: message.text,
      active_agents: context.active_agent_keys,
      recent_history: context.recent_messages,
    });

    switch (mode.execution_mode) {
      case "task":
      case "agent":
        return { route: "pty_spawn", resource_profile: "heavy" };
      case "once":
        return { route: "native_turn" };
      case "inquiry":
        return { route: "direct_reply", direct_content: mode.answer };
      case "builtin":
        return { route: "direct_reply" };
    }
  }
}
```

### 라우팅 결정 기준

| 분류 | 라우팅 | 이유 |
|------|--------|------|
| **task/agent** | PTY spawn | 멀티턴 도구 사용, 파일 수정, 장시간 작업 → 컨테이너 격리 필요 |
| **once** | Native turn | 단일 API 호출로 충분, 도구 미사용 또는 간단한 도구 |
| **inquiry** | Direct reply | 활성 태스크 상태 조회 → DB 쿼리만으로 응답 가능 |
| **builtin** | Direct reply | 슬래시 커맨드 → 기존 핸들러로 위임 |

### 기존 OrchestrationService와의 관계

Gateway는 OrchestrationService의 `classify_execution_mode()`를 **앞으로 꺼낸 것**이다.

```
현재: OrchestrationService 안에서 분류 + 실행이 동시에 일어남
      → classify_execution_mode() → run_once() / run_agent_loop() / run_task_loop()

제안: Gateway가 분류를 먼저 수행, 실행은 적절한 백엔드에 위임
      → Gateway.classify() → route에 따라 ContainerCliAgent 또는 NativeAgent
```

OrchestrationService는 여전히 유효하되, **실행 전용**으로 역할이 축소된다. 분류 책임은 Gateway로 이동.

---

## Layer 1: AgentBus (통신)

에이전트 간 통신의 유일한 인터페이스. Pty 인터페이스 위에 메시지 패턴을 구현한다.

### 통신 패턴

```typescript
class AgentBus {
  private transport: AgentTransport;
  private permissions: CommPermission[];
  private pending: Map<string, PendingRequest>;
  private lanes: Map<string, LaneQueue>;

  /** request/reply — 다른 에이전트에게 질문하고 답을 기다림. */
  async ask(from: string, to: string, content: string): Promise<string>;

  /** fire-and-forget — 작업 위임, 답 안 기다림. */
  async send(to: string, content: string): Promise<void>;

  /** broadcast — 전체 에이전트에 알림. */
  async broadcast(content: string, filter?: (key: string) => boolean): Promise<void>;

  /** stream — 진행 상황 실시간 중계. */
  on(event: "agent_output", handler: (key: string, msg: AgentOutputMessage) => void): void;
}
```

### Lane Queue — 세션별 메시지 직렬화

에이전트가 실행 중일 때 새 메시지가 도착하면 3가지 모드로 처리:

```typescript
type LaneMode = "steer" | "followup" | "collect";

interface LaneQueue {
  /** 현재 실행 중인 에이전트에 즉시 주입. */
  steer(session_key: string, content: string): Promise<void>;
  /** 현재 턴 완료 후 새 턴으로 큐. */
  followup(session_key: string, content: string): void;
  /** 메시지 수집 후 배치 전달. */
  collect(session_key: string, content: string): void;
  /** 큐에 쌓인 메시지를 drain. */
  flush(session_key: string): Promise<void>;
}
```

| 모드 | 동작 | 용도 |
|------|------|------|
| `steer` | 실행 중 에이전트 stdin에 즉시 write | 긴급 지시, 방향 수정 |
| `followup` | `complete` 이벤트 후 다음 턴으로 전달 | 후속 질문, 추가 작업 |
| `collect` | 여러 메시지를 모아서 한번에 배치 전달 | 빠른 연속 입력 합치기 |

기본값은 **직렬 실행** — 같은 세션 내에서 동시 턴 금지로 경합 조건 방지.

### 이중 중첩 직렬화 (Double-Nested Lane)

Pi Execute Runner는 세션 레인과 글로벌 레인을 중첩하여 교착 상태를 방지한다:

```typescript
// 세션 레인: 같은 세션 내 동시 mutation 방지
const session_lane = resolve_session_lane(session_key);
// 글로벌 레인: 인프라 수준 자원 경합 방지
const global_lane = resolve_global_lane(lane_id);

return enqueue(session_lane, () =>
  enqueue(global_lane, async () => {
    // 양쪽 레인이 모두 슬롯을 허용해야 실행
    return run_attempt(session_key, prompt);
  })
);
```

**락 획득 순서**: 세션 → 글로벌 (고정 순서로 교착 방지). FIFO 큐로 같은 세션의 동시 호출이 직렬화된다.

### AgentTransport — Pty 인터페이스 기반 transport 추상화

```typescript
interface AgentTransport {
  write(session_key: string, msg: AgentInputMessage): Promise<void>;
  on_output(handler: (key: string, msg: AgentOutputMessage) => void): void;
  list_agents(): string[];
}

// Pty 인터페이스를 AgentTransport로 브릿지
class PtyTransport implements AgentTransport {
  private ptys: Map<string, Pty>;

  async write(session_key: string, msg: AgentInputMessage): Promise<void> {
    this.ptys.get(session_key)!.write(JSON.stringify(msg) + "\n");
  }

  on_output(handler): void {
    for (const [key, pty] of this.ptys) {
      pty.onData((data) => {
        for (const line of data.split("\n").filter(Boolean)) {
          const msg = parse_ndjson(line);
          if (msg) handler(key, msg);
        }
      });
    }
  }
}
```

### 통신 흐름 (ask_agent)

```
Agent A                AgentBus               Agent B
  │                  (orchestrator)              │
  │ ask_agent_request    │                       │
  ├─────────────────────→│ 1. 권한 검증           │
  │                      │ 2. 로깅               │
  │                      │ 3. pty.write()        │
  │                      ├──────────────────────→│
  │                      │    ask_agent_request   │
  │                      │                       │
  │                      │←──────────────────────┤
  │                      │    ask_agent_response  │
  │   ask_agent_response │ 4. pending resolve    │
  │←─────────────────────┤ 5. 로깅               │
```

### 권한 매트릭스

```typescript
type CommPermission = {
  from: string;
  to: string;
  allowed: boolean;
  max_depth?: number;  // 체인 깊이 제한 (A→B→C 무한루프 방지)
};
```

---

## Layer 2: ContainerPool (관리)

`Pty` 인스턴스의 생명주기를 관리. Docker API를 통해 컨테이너를 제어한다.

### ContainerPool

```typescript
class ContainerPool {
  private ptys = new Map<string, Pty>();
  private docker: DockerOps;
  private adapter: CliAdapter;

  /** 컨테이너가 없으면 spawn, 있으면 재사용. */
  async ensure_running(session_key: string): Promise<Pty> {
    if (this.ptys.has(session_key)) return this.ptys.get(session_key)!;
    const pty = spawn(
      this.adapter.cli_id,
      this.adapter.build_cmd(session_key),
      { name: to_container_name(session_key), cwd: "/workspace", ... }
    );
    this.ptys.set(session_key, pty);
    pty.onExit(() => this.ptys.delete(session_key));
    return pty;
  }

  /** 유휴 컨테이너 정리. */
  async cleanup(max_idle_ms: number): Promise<void>;

  /** docker ps로 실제 상태와 동기화. */
  async reconcile(): Promise<void>;
}
```

### DockerOps — Docker API 추상화

```typescript
interface DockerOps {
  create(opts: ContainerCreateOpts): Promise<string>;
  start(id: string): Promise<void>;
  attach(id: string): Promise<{ stdin: Writable; stdout: Readable }>;
  stop(id: string, timeout_s?: number): Promise<void>;
  kill(id: string): Promise<void>;
  rm(id: string): Promise<void>;
  inspect(id: string): Promise<ContainerInfo>;
  list(filters: Record<string, string[]>): Promise<ContainerInfo[]>;
  stats(id: string): Promise<ContainerStats>;
  events(filters: Record<string, string[]>): AsyncIterable<DockerEvent>;
}
```

### 세션 키 → 컨테이너 네이밍

```
session key: slack:C123:butler     → container: agent-slack-C123-butler
session key: subagent:task-42      → container: agent-subagent-task-42
```

### 컨테이너 생명주기

| 이벤트 | 동작 |
|--------|------|
| **생성** | `spawn()` → `docker create` + `start` + `attach` |
| **유휴 정리** | `max_idle_ms` 초과 → `kill()` + `docker rm` |
| **에러 복구** | `onExit` 콜백 → pool에서 제거, 다음 요청 시 재생성 |
| **orchestrator 재시작** | `docker ps --filter label=sf.session_key` → `docker attach` 재연결 |

### 복구 (reconcile)

```
Orchestrator 재시작 시:
1. docker ps --filter label=sf.session_key → 살아있는 에이전트 발견
2. docker attach → stdin/stdout 스트림 복원
3. Pty 인스턴스 재구성 (write/onData/onExit 다시 연결)
4. 죽은 컨테이너 → docker rm, 필요 시 재생성
```

---

## 보안 모델

### Docker Socket Proxy

```yaml
services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTAINERS: 1    # container API만 허용
      IMAGES: 0
      NETWORKS: 0
      VOLUMES: 0
      POST: 1

  orchestrator:
    environment:
      DOCKER_HOST: tcp://docker-proxy:2375
```

### 에이전트 컨테이너 격리

모든 보안 설정은 `spawn()` 시 Docker 컨테이너 생성 옵션에 포함된다:

| 보안 수단 | 설정 |
|-----------|------|
| Linux capabilities | `--cap-drop ALL` |
| 권한 상승 차단 | `--security-opt no-new-privileges` |
| 루트 파일시스템 | `--read-only` |
| 실행 사용자 | `--user 1000:1000` |
| 프로세스 제한 | `--pids-limit 100` |
| 네트워크 | `--network none` |
| 파일시스템 | volume mount 범위로 제한 |

### 다층 방어 구조

```
Layer 1 (Gateway)   : 경량 분류 — 불필요한 PTY spawn 방지
Layer 2 (AgentBus)  : 통신 권한 매트릭스 — 누가 누구에게 요청 가능한지 검증
Layer 3 (AgentBus)  : 도구 필터링 — 역할별 허용 도구만 노출
Layer 4 (Docker)    : 파일시스템 — volume mount 범위 밖 접근 불가
Layer 5 (Docker)    : 네트워크 — network:none → orchestrator 우회 불가능
Layer 6 (Docker)    : 리소스 — memory/cpu 제한으로 DoS 방지
Layer 7 (Proxy)     : Docker socket — API 화이트리스트
```

`network_mode: none` → **에이전트의 유일한 외부 통신 경로가 `Pty.write()`/`onData()`**. 프롬프트 인젝션이 Layer 2-3을 뚫어도 Layer 4-7이 OS 수준에서 차단.

### 시크릿 관리

```yaml
services:
  agent-butler:
    secrets:
      - anthropic_api_key   # /run/secrets/ (메모리 내 tmpfs)
```

`spawn()` 시 `env`로 전달하지 않고, Docker secrets 경유.

---

## NDJSON 와이어 프로토콜

`Pty.write()`/`onData()`를 통해 줄 단위 JSON(NDJSON)으로 통신한다.

### 입력 메시지 (orchestrator → 컨테이너)

```typescript
type AgentInputMessage =
  | { type: "user_message"; content: string; metadata?: Record<string, unknown> }
  | { type: "ask_agent_request"; from: string; content: string; request_id: string };
```

### 출력 메시지 (컨테이너 → orchestrator)

```typescript
type AgentOutputMessage =
  | { type: "assistant_chunk"; content: string; delta: true }
  | { type: "assistant_message"; content: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "complete"; result: string; usage?: { input: number; output: number } }
  | { type: "error"; code: "timeout" | "crash" | "token_limit"; message: string };
```

### CLI별 실제 출력 포맷

CLI마다 출력 형식이 다르다. `CliAdapter.parse_output()`이 `AgentOutputMessage`로 매핑한다.

**Claude Code** (`--output-format stream-json`):
```jsonl
{"type":"system","subtype":"init","session_id":"550e8400-..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"안녕"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"안녕하세요!"}]}}
{"type":"result","result":"안녕하세요! 무엇을 도와드릴까요?","session_id":"550e8400-..."}
```

어댑터 매핑:
| Claude Code 이벤트 | AgentOutputMessage |
|---|---|
| `{"type":"system","subtype":"init"}` | (내부 처리 — session_id 저장) |
| `{"type":"assistant","message":{...}}` | `{"type":"assistant_chunk", ...}` |
| `{"type":"result","result":"..."}` | `{"type":"complete","result":"..."}` |

### 턴 경계

- `complete` 또는 `error` 이벤트가 **턴의 끝**을 표시
- NDJSON 파싱: `\n` 구분, 빈 줄 무시, JSON 파싱 실패 시 skip + 경고 로그

> 상세 동시성 정책(큐잉, 데드락 방지)은 [Phase Loop 설계 — §3 ask_agent 동시성 정책](./phase-loop.md#3-ask_agent-동시성-정책)을 참조.

---

## 서브에이전트 컨테이너화

### 현재 구조 (per-iteration spawn)

```
_run_subagent(iterations=15)
  for iteration in 0..15:
    controller.plan(task, last_output)  ← orchestrator LLM
    executor.run(plan.executor_prompt)  ← 매번 새 프로세스
    last_output = executor.result       ← 이전 컨텍스트 소실
```

### 컨테이너 구조 (persistent executor)

```
_run_subagent(iterations=15)
  pty = pool.ensure_running(subagent:{id})
  for iteration in 0..15:
    controller.plan(task, last_output)
    pty.write(plan.executor_prompt)       ← 같은 Pty에 write
    last_output = wait_for_complete(pty)  ← 컨텍스트 보존
  pty.kill()
```

### spawn_and_wait → spawn_and_converse

```typescript
// 현재: 1회성 fire-and-forget
spawn_and_wait(task) → result → 프로세스 종료

// 컨테이너: 대화 가능한 에이전트
const pty = spawn("claude", ["--headless", ...], { name: "agent-task-42", ... });
pty.write(task);
pty.onData((data) => { /* 결과 수신 */ });
// ... 추가 대화 ...
pty.write(followup);
// ... 완료 후 ...
pty.kill();
```

---

## 에이전트 러너 이미지

```dockerfile
FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code@latest
RUN npm install -g @openai/codex@latest

WORKDIR /workspace
ENTRYPOINT []
```

`spawn(file, args)` 시 `file`과 `args`가 컨테이너의 CMD로 전달된다.

---

## 실행 루프 — Retry + Compaction + Auth Rotation + Failover

ContainerCliAgent는 단순히 요청을 전달하고 결과를 받는 것이 아니라, **에러 유형에 따라 자동 복구**한다. (참조: OpenClaw Pi Execute Runner `run.ts`)

### 동적 재시도 상한

고정 `MAX_ATTEMPTS` 대신, Auth 프로파일 수에 비례하여 상한을 스케일링:

```typescript
const BASE_RETRY = 24;
const PER_PROFILE = 8;

function resolve_max_iterations(profile_count: number): number {
  const scaled = BASE_RETRY + Math.max(1, profile_count) * PER_PROFILE;
  return Math.min(160, Math.max(32, scaled));  // 범위: [32, 160]
}
```

프로파일 1개 → 32회, 17개 → 160회(캡). 재시도 예산이 인프라 규모에 비례한다.

### 실행 루프 (상세)

```typescript
async run(options: AgentRunOptions): Promise<AgentRunResult> {
  const max_iterations = resolve_max_iterations(this.auth_profiles.length);
  let iteration = 0;
  let compaction_attempts = 0;
  let tool_truncation_attempted = false;
  const attempted_thinking = new Set<ThinkingLevel>();

  while (iteration++ < max_iterations) {
    const pty = await this.pool.ensure_running(options.session_key);
    const result = await this.bus.send_and_wait(options.session_key, options.prompt);

    if (result.type === "complete") {
      await this.mark_profile_good(this.current_profile);
      return result;
    }

    const error_class = classify_error(result);

    // ── Branch 1: Context Overflow → 3단계 복구 파이프라인 ──
    if (error_class === "context_overflow") {
      if (compaction_attempts < MAX_COMPACTION_ATTEMPTS) {
        const compacted = await this.compact(options.session_key);
        if (compacted) { compaction_attempts++; continue; }
      }
      if (!tool_truncation_attempted) {
        tool_truncation_attempted = true;
        const truncated = await this.truncate_oversized_tool_results(options.session_key);
        if (truncated) continue;
      }
      return { type: "error", code: "token_limit", message: "Context overflow after recovery attempts" };
    }

    // ── Branch 2: Auth Error → 프로파일 로테이션 ──
    if (error_class === "auth_error") {
      await this.mark_profile_failure(this.current_profile, "auth");
      const rotated = await this.advance_auth_profile();
      if (rotated) { attempted_thinking.clear(); continue; }
      // 모든 프로파일 소진 → 모델 레벨 failover
      if (this.fallback_configured) {
        throw new FailoverError(result.message, { reason: "auth", provider: this.provider });
      }
      return { type: "error", code: "auth", message: "All auth profiles exhausted" };
    }

    // ── Branch 3: Rate Limit → 백오프 (timeout은 프로파일 cooldown 안 함) ──
    if (error_class === "rate_limit") {
      await delay(exponential_backoff(iteration));
      continue;
    }

    // ── Branch 4: Crash → 컨테이너 재생성 ──
    if (error_class === "crash") {
      await this.pool.remove(options.session_key);
      continue;
    }

    // ── Branch 5: Failover → 프로파일 로테이션 후 모델 전환 ──
    if (error_class === "failover") {
      await this.mark_profile_failure(this.current_profile, classify_failover_reason(result));
      const rotated = await this.advance_auth_profile();
      if (rotated) continue;
      if (this.fallback_configured) {
        throw new FailoverError(result.message, { reason: "unknown", provider: this.provider });
      }
    }

    // ── Unrecoverable ──
    throw new AgentError(result.message);
  }
  throw new AgentError("max iterations exceeded");
}
```

### Context Overflow 복구 파이프라인

```
overflow 감지
  ├─ compaction 시도 (최대 3회)
  │   ├─ 성공 → retry
  │   └─ 실패 또는 횟수 소진 ↓
  ├─ tool result truncation (1회)
  │   ├─ 성공 → retry
  │   └─ 실패 ↓
  └─ give up (사용자에게 /reset 또는 더 큰 모델 권고)
```

핵심: tool result truncation은 compaction 횟수를 리셋하지 않음 — 무한 루프 방지.

### Auth Profile Rotation

```typescript
async advance_auth_profile(): Promise<boolean> {
  if (this.locked_profile) return false;       // 잠긴 프로파일은 로테이션 불가
  let next = this.profile_index + 1;
  while (next < this.profile_candidates.length) {
    const candidate = this.profile_candidates[next];
    if (is_in_cooldown(candidate)) { next++; continue; }   // cooldown 중 건너뛰기
    try {
      await this.apply_auth(candidate);
      this.profile_index = next;
      return true;
    } catch { next++; }
  }
  return false;   // 모든 프로파일 소진
}
```

- 로테이션 성공 시 thinking level 리셋 + attempted set 클리어
- timeout은 프로파일 cooldown을 마킹하지 않음 (모델/네트워크 이슈)
- 성공 완료 시 `mark_profile_good()` 호출하여 cooldown 해제

### Model Failover — 외부 오케스트레이터 위임

`ContainerCliAgent`는 모델 전환을 직접 수행하지 않는다. 모든 프로파일 소진 시 `FailoverError`를 throw하고, 외부 오케스트레이터가 다음 모델로 전환한다.

```typescript
class FailoverError extends Error {
  constructor(message: string, public readonly meta: {
    reason: "auth" | "rate_limit" | "quota" | "timeout" | "unknown";
    provider: string;
    model?: string;
    profile_id?: string;
  }) { super(message); }
}
```

**Failover를 throw하는 조건:**
1. Auth 프로파일 모두 소진 + `fallback_configured`
2. Failover 에러 + 프로파일 모두 소진 + `fallback_configured`

**내부 처리 (throw 안 함):**
- Context overflow → compaction/truncation
- Crash → 컨테이너 재생성
- Rate limit → 백오프

### Context Window Guard — Pre-flight 검증

재시도 루프 진입 전에 모델의 컨텍스트 윈도우가 최소 요건을 충족하는지 확인:

```typescript
const guard = evaluate_context_window_guard({
  info: context_info,
  hard_min_tokens: 8_000,
  warn_below_tokens: 16_000,
});
if (guard.should_block) {
  throw new FailoverError(
    `Model context window too small (${guard.tokens} tokens)`,
    { reason: "unknown", provider }
  );
}
```

### 에러 분류 체계

```typescript
type ErrorClass =
  | "context_overflow"  // 컨텍스트 초과
  | "auth_error"        // API 키/인증 실패
  | "rate_limit"        // 속도 제한 또는 타임아웃
  | "crash"             // 컨테이너 비정상 종료
  | "failover"          // 모델 레벨 전환 필요
  | "billing"           // 과금 한도 초과
  | "fatal";            // 복구 불가

function classify_error(msg: AgentOutputMessage): ErrorClass {
  if (msg.type !== "error") return "fatal";
  const text = msg.message ?? "";

  // 패턴 매칭 — Pi Execute Runner의 세분화된 분류 참조
  if (msg.code === "token_limit" || /context.*overflow|prompt.*too.*large/i.test(text))
    return "context_overflow";
  if (/invalid.*api.*key|unauthorized|authentication/i.test(text))
    return "auth_error";
  if (/rate.*limit|too.*many.*requests/i.test(text))
    return "rate_limit";
  if (/billing|quota.*exceeded|insufficient.*funds/i.test(text))
    return "billing";
  if (msg.code === "crash")
    return "crash";
  if (/failover|model.*unavailable|overloaded/i.test(text))
    return "failover";
  return "fatal";
}
```

---

## 백엔드 구조

```
AgentBackend
  ├─ ContainerCliAgent       ← headless CLI 통합 (claude, codex 등)
  │   ├─ AgentBus            (통신 — Pty 인터페이스 기반 + Lane Queue)
  │   ├─ ContainerPool       (관리 — spawn/kill/reconcile)
  │   ├─ CliAdapter          (CLI별 차이 흡수)
  │   └─ RetryLoop           (에러 분류 → compact/rotate/backoff/respawn)
  │
  ├─ ClaudeSdkAgent          (네이티브 SDK)
  ├─ CodexAppserverAgent     (네이티브 AppServer)
  └─ OpenAiCompatibleAgent   (HTTP API)
```

### CliAdapter — CLI별 차이 흡수

```typescript
interface CliAdapter {
  readonly cli_id: string;
  build_cmd(session_key: string): string[];
  parse_output(line: string): AgentOutputMessage | null;
  format_input(msg: AgentInputMessage): string;
}
```

### Pty 구현 교체

```
Pty 인터페이스 (spawn/write/onData/onExit/kill)
  ├─ DockerPty   ← 프로덕션 (Docker 컨테이너)
  └─ LocalPty    ← 개발용 (node-pty, Docker 없이)
```

상위 레이어(AgentBus, ContainerPool)는 `Pty` 인터페이스만 의존. Docker인지 로컬 PTY인지 모른다.

---

## 설계 과제

| 과제 | 접근 방향 |
|------|----------|
| **완료 감지** | NDJSON `{"type":"complete"}` 이벤트 + `onData` 콜백 |
| **동시성** | AgentBus: request_queue (깊이 3, 타임아웃 30초) |
| **유휴 정리** | ContainerPool: `max_idle_ms` 초과 → `kill()` + `docker rm` |
| **에러 복구** | `onExit` 콜백 → pool에서 제거 → 다음 요청 시 `spawn()` |
| **orchestrator 재시작** | `docker ps --filter` → `docker attach` → Pty 재구성 |
| **리소스 제한** | `spawn()` 옵션: memory, cpus, pids_limit |
| **보안** | Docker socket proxy + `network:none` + `--cap-drop ALL` |
| **개발 환경** | LocalPty (node-pty) — Docker 없이 동일 인터페이스 |

## 관련 문서

→ [Phase Loop 설계](./phase-loop.md) — 컨테이너 에이전트의 이상적 사용처
→ [에이전트 시스템](../core-concepts/agents.md)
→ [프로바이더 설정 가이드](../guide/providers.md)
