/**
 * 워크플로우 노드 타입 — Phase(Agent) + 오케스트레이션(HTTP/Code/IF/Merge/Set) 통합.
 * n8n 스타일 DAG 실행을 위한 노드 유니온 타입.
 */

import type {
  PhaseAgentDefinition,
  PhaseCriticDefinition,
  PhaseDefinition,
  PhaseFailurePolicy,
  PhaseMode,
} from "./phase-loop.types.js";

// ── Output Schema ───────────────────────────────────

export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "unknown";

export interface OutputField {
  name: string;
  type: FieldType;
  description?: string;
}

// ── Node Base ───────────────────────────────────────

export interface NodeBase {
  node_id: string;
  title: string;
  depends_on?: string[];
  /** 커스텀 출력 필드 정의 (없으면 노드 타입별 기본값). */
  output_schema?: OutputField[];
}

// ── Phase (Agent) Node ──────────────────────────────

export interface PhaseNodeDefinition extends NodeBase {
  node_type: "phase";
  agents: PhaseAgentDefinition[];
  critic?: PhaseCriticDefinition;
  context_template?: string;
  failure_policy?: PhaseFailurePolicy;
  quorum_count?: number;
  mode?: PhaseMode;
  loop_until?: string;
  max_loop_iterations?: number;
  tools?: string[];
  skills?: string[];
}

// ── HTTP Request Node ───────────────────────────────

export interface HttpNodeDefinition extends NodeBase {
  node_type: "http";
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeout_ms?: number;
  /** User-Agent 헤더 편의 필드. headers에 이미 있으면 무시. */
  user_agent?: string;
}

// ── Code Node ───────────────────────────────────────

/** 컨테이너 샌드박스 지원 언어. JS/shell은 인프로세스, 나머지는 컨테이너 실행. */
export type CodeLanguage =
  | "javascript" | "shell"
  | "python" | "ruby" | "bash" | "go" | "rust" | "deno" | "bun";

export interface CodeNodeDefinition extends NodeBase {
  node_type: "code";
  language: CodeLanguage;
  code: string;
  timeout_ms?: number;
  /** 컨테이너 런타임 오버라이드. 미지정 시 언어별 기본 이미지 사용. */
  container_image?: string;
  /** 컨테이너 네트워크 허용 (pip install, API 호출 등). 기본 false. */
  network_access?: boolean;
  /** 컨테이너를 실행 후 유지 (재사용). 기본 false (one-shot). */
  keep_container?: boolean;
}

// ── IF (Conditional Branch) Node ────────────────────

export interface IfNodeDefinition extends NodeBase {
  node_type: "if";
  /** JS 표현식. memory 객체를 컨텍스트로 평가. */
  condition: string;
  outputs: {
    true_branch: string[];
    false_branch: string[];
  };
}

// ── Merge (Join) Node ───────────────────────────────

export interface MergeNodeDefinition extends NodeBase {
  node_type: "merge";
  merge_mode: "wait_all" | "first_completed" | "collect";
}

// ── Set (Variable Assignment) Node ──────────────────

export interface SetNodeDefinition extends NodeBase {
  node_type: "set";
  assignments: Array<{ key: string; value: unknown }>;
}

// ── Split (Array Decomposition) Node ────────────────

export interface SplitNodeDefinition extends NodeBase {
  node_type: "split";
  /** 분리할 배열 필드 경로 (예: "body.users"). */
  array_field: string;
  /** 배치 크기 (기본 1 = 하나씩). */
  batch_size?: number;
}

// ── Trigger Node ────────────────────────────────────

export type TriggerType = "cron" | "webhook" | "manual" | "channel_message" | "kanban_event" | "filesystem_watch";

export interface TriggerNodeDefinition extends NodeBase {
  node_type: "trigger";
  trigger_type: TriggerType;
  /** cron */
  schedule?: string;
  timezone?: string;
  /** webhook */
  webhook_path?: string;
  /** channel_message */
  channel_type?: string;
  chat_id?: string;
  /** kanban_event */
  kanban_board_id?: string;
  kanban_actions?: string[];
  kanban_column_id?: string;
  /** filesystem_watch */
  watch_path?: string;
  watch_events?: Array<"add" | "change" | "unlink">;
  watch_pattern?: string;
  watch_batch_ms?: number;
}

// ── LLM Node ───────────────────────────────────────

export interface LlmNodeDefinition extends NodeBase {
  node_type: "llm";
  backend: string;
  model?: string;
  prompt_template: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  /** 구조화 출력 JSON 스키마 (없으면 자유 텍스트). */
  output_json_schema?: Record<string, unknown>;
}

// ── Switch Node ────────────────────────────────────

export interface SwitchNodeDefinition extends NodeBase {
  node_type: "switch";
  /** 평가할 JS 표현식 (결과값으로 분기). */
  expression: string;
  cases: Array<{ value: string; targets: string[] }>;
  default_targets?: string[];
}

// ── Wait Node ──────────────────────────────────────

export interface WaitNodeDefinition extends NodeBase {
  node_type: "wait";
  wait_type: "timer" | "webhook" | "approval";
  delay_ms?: number;
  webhook_path?: string;
  approval_message?: string;
}

// ── Template Node ──────────────────────────────────

export interface TemplateNodeDefinition extends NodeBase {
  node_type: "template";
  template: string;
  output_field?: string;
}

// ── OAuth Node ─────────────────────────────────────

export interface OauthNodeDefinition extends NodeBase {
  node_type: "oauth";
  service_id: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeout_ms?: number;
}

// ── Sub-workflow Node ──────────────────────────────

export interface SubWorkflowNodeDefinition extends NodeBase {
  node_type: "sub_workflow";
  workflow_name: string;
  input_mapping?: Record<string, string>;
  timeout_ms?: number;
}

// ── Filter Node ───────────────────────────────────

export interface FilterNodeDefinition extends NodeBase {
  node_type: "filter";
  /** JS 표현식 — `item`으로 각 요소 참조. */
  condition: string;
  /** 필터링 대상 배열 필드 경로. */
  array_field: string;
}

// ── Loop Node ─────────────────────────────────────

export interface LoopNodeDefinition extends NodeBase {
  node_type: "loop";
  /** 순회 대상 배열 필드 경로. */
  array_field: string;
  /** 루프 본문에서 실행할 노드 ID 목록. */
  body_nodes?: string[];
  /** 최대 반복 횟수 (안전장치). */
  max_iterations?: number;
}

// ── Transform Node ────────────────────────────────

export interface TransformNodeDefinition extends NodeBase {
  node_type: "transform";
  /** JS 표현식 — `item`으로 각 요소 참조, 새 형태 반환. */
  expression: string;
  /** 변환 대상 배열 필드 경로. */
  array_field: string;
}

// ── DB Node ───────────────────────────────────────

export interface DbNodeDefinition extends NodeBase {
  node_type: "db";
  operation: "query" | "insert" | "update" | "delete";
  /** 데이터소스 식별자 (설정에서 관리). */
  datasource: string;
  /** SQL 또는 쿼리 표현식 (템플릿 지원). */
  query: string;
  /** INSERT/UPDATE 시 파라미터. */
  params?: Record<string, unknown>;
}

// ── File Node ─────────────────────────────────────

export interface FileNodeDefinition extends NodeBase {
  node_type: "file";
  operation: "read" | "write" | "extract";
  /** 파일 경로 (템플릿 지원). */
  file_path: string;
  /** write 시 내용. */
  content?: string;
  /** extract 시 포맷 (csv, json, text). */
  format?: "csv" | "json" | "text";
}

// ── Analyzer Node ─────────────────────────────────

export interface AnalyzerNodeDefinition extends NodeBase {
  node_type: "analyzer";
  /** llm (기본) | sentiment (AFINN 어휘 기반 감성 분석). */
  mode?: string;
  /** LLM 백엔드 (openrouter, claude_sdk 등). */
  backend: string;
  model?: string;
  /** 분석 지시 프롬프트. */
  prompt_template: string;
  /** 분석 대상 입력 필드 경로. */
  input_field: string;
  /** 구조화 출력 JSON 스키마. */
  output_json_schema?: Record<string, unknown>;
  /** 분류/판정 결과에 사용할 카테고리 목록. */
  categories?: string[];
  temperature?: number;
  /** sentiment mode 전용: analyze/batch/compare/keywords/score_text. */
  sentiment_action?: string;
}

// ── Retriever Node ────────────────────────────────

export interface RetrieverNodeDefinition extends NodeBase {
  node_type: "retriever";
  /** 검색 소스 타입. */
  source: "http" | "file" | "memory";
  /** HTTP 소스: 검색 API URL (템플릿 지원). */
  url?: string;
  /** HTTP 소스: 메서드. */
  method?: "GET" | "POST";
  /** File 소스: 검색 대상 파일/디렉토리 경로. */
  file_path?: string;
  /** 검색 쿼리 (템플릿 지원). */
  query: string;
  /** 반환할 최대 결과 수. */
  top_k?: number;
}

// ── AI Agent Node ─────────────────────────────────

export interface AiAgentNodeDefinition extends NodeBase {
  node_type: "ai_agent";
  /** LLM 백엔드. */
  backend: string;
  model?: string;
  /** 에이전트 시스템 프롬프트. */
  system_prompt: string;
  /** 사용자 입력 (템플릿 지원). */
  user_prompt: string;
  /** 에이전트가 사용할 수 있는 도구 노드 ID 목록. */
  tool_nodes?: string[];
  /** 최대 턴 수 (도구 호출 반복 제한). */
  max_turns?: number;
  temperature?: number;
  /** 구조화 출력 스키마. */
  output_json_schema?: Record<string, unknown>;
}

// ── Text Splitter Node ────────────────────────────

export interface TextSplitterNodeDefinition extends NodeBase {
  node_type: "text_splitter";
  /** 분할 대상 텍스트 필드 경로. */
  input_field: string;
  /** 청크 크기 (문자 수). */
  chunk_size: number;
  /** 청크 간 오버랩 (문자 수). */
  chunk_overlap: number;
  /** 분할 구분자. */
  separator?: string;
}

// ── Task Node ─────────────────────────────────────

export interface TaskNodeDefinition extends NodeBase {
  node_type: "task";
  /** 태스크 제목. */
  task_title: string;
  /** 태스크 목표 (템플릿 지원). */
  objective: string;
  /** 실행할 채널. */
  channel?: string;
  chat_id?: string;
  /** 최대 턴 수. */
  max_turns?: number;
  /** 초기 메모리 매핑 (템플릿 지원). */
  initial_memory?: Record<string, string>;
}

// ── Spawn Agent Node ──────────────────────────────

export interface SpawnAgentNodeDefinition extends NodeBase {
  node_type: "spawn_agent";
  /** 에이전트에게 전달할 태스크 (템플릿 지원). */
  task: string;
  /** 에이전트 역할. */
  role?: string;
  /** LLM 모델. */
  model?: string;
  /** 발신 채널 (결과 보고용). */
  origin_channel?: string;
  origin_chat_id?: string;
  /** 완료까지 대기할지 여부. */
  await_completion?: boolean;
  /** 최대 반복 횟수. */
  max_iterations?: number;
}

// ── Decision Node ─────────────────────────────────

export interface DecisionNodeDefinition extends NodeBase {
  node_type: "decision";
  operation: "append" | "list" | "get_effective" | "archive";
  scope?: "global" | "team" | "agent";
  scope_id?: string;
  /** append 시: 결정 키. */
  key?: string;
  /** append 시: 결정 값 (템플릿 지원). */
  value?: string;
  rationale?: string;
  priority?: 0 | 1 | 2 | 3;
  tags?: string[];
  /** archive 시: 대상 ID. */
  target_id?: string;
}

// ── Promise Node ──────────────────────────────────

export interface PromiseNodeDefinition extends NodeBase {
  node_type: "promise";
  operation: "append" | "list" | "get_effective" | "archive";
  scope?: "global" | "team" | "agent";
  scope_id?: string;
  key?: string;
  value?: string;
  rationale?: string;
  priority?: 0 | 1 | 2 | 3;
  tags?: string[];
  target_id?: string;
}

// ── Embedding / Vector Store ─────────────────────────

export interface EmbeddingNodeDefinition extends NodeBase {
  node_type: "embedding";
  /** 임베딩할 텍스트 필드 (memory 경로). */
  input_field: string;
  /** 임베딩 모델 ID (orchestrator-llm 레지스트리). */
  model: string;
  /** 배치 크기 (한번에 임베딩할 텍스트 수). */
  batch_size?: number;
  /** 출력 차원수 (모델 기본값 사용 시 생략). */
  dimensions?: number;
}

export interface VectorStoreNodeDefinition extends NodeBase {
  node_type: "vector_store";
  operation: "upsert" | "query" | "delete";
  /** 벡터 스토어 ID (datasource 레지스트리). */
  store_id: string;
  /** 컬렉션/인덱스 이름. */
  collection: string;
  /** upsert: 벡터 + 메타데이터 소스 필드. */
  vectors_field?: string;
  documents_field?: string;
  /** query: 쿼리 벡터 필드. */
  query_vector_field?: string;
  /** query: 반환 결과 수. */
  top_k?: number;
  /** query: 유사도 임계값 (0~1). */
  min_score?: number;
  /** delete: 삭제 대상 ID 필드. */
  ids_field?: string;
  /** 메타데이터 필터 (JSON). */
  filter?: Record<string, unknown>;
}

// ── Notify Node ──────────────────────────────────────

export interface NotifyNodeDefinition extends NodeBase {
  node_type: "notify";
  /** 메시지 내용 (템플릿 지원). */
  content: string;
  /** 전송 대상. origin: 트리거 채널, specified: 지정 채널. */
  target: "origin" | "specified";
  /** target=specified 시 채널 ID. */
  channel?: string;
  chat_id?: string;
  /** 메시지 parse 모드 (markdown 등). */
  parse_mode?: string;
}

// ── Aggregate Node ───────────────────────────────────

export type AggregateOperation = "collect" | "count" | "sum" | "avg" | "min" | "max" | "join" | "unique" | "flatten";

export interface AggregateNodeDefinition extends NodeBase {
  node_type: "aggregate";
  /** 집계 연산. */
  operation: AggregateOperation;
  /** 집계 대상 배열 필드 경로. */
  array_field: string;
  /** join 연산 시 구분자. */
  separator?: string;
}

// ── Send File Node ───────────────────────────────────

export interface SendFileNodeDefinition extends NodeBase {
  node_type: "send_file";
  /** 전송할 파일 경로 (템플릿 지원). */
  file_path: string;
  /** 파일과 함께 보낼 캡션. */
  caption?: string;
  /** 전송 대상. origin: 트리거 채널, specified: 지정 채널. */
  target: "origin" | "specified";
  channel?: string;
  chat_id?: string;
}

// ── Error Handler Node ───────────────────────────────

export interface ErrorHandlerNodeDefinition extends NodeBase {
  node_type: "error_handler";
  /** 에러 감시 대상 노드 ID 목록. */
  try_nodes: string[];
  /** 에러 발생 시 동작. continue: 다음 노드 진행, fallback: fallback_nodes 실행. */
  on_error: "continue" | "fallback";
  /** fallback 시 실행할 노드 ID 목록. */
  fallback_nodes?: string[];
}

// ── HITL (Human-in-the-Loop) Node ────────────────────

export interface HitlNodeDefinition extends NodeBase {
  node_type: "hitl";
  /** 사용자에게 보낼 질문 (템플릿 지원). */
  prompt: string;
  /** 전송 대상. origin: 트리거 채널, specified: 지정 채널. */
  target: "origin" | "specified";
  /** target=specified 시 채널 ID. */
  channel?: string;
  chat_id?: string;
  /** 응답 대기 제한 시간 (ms). 기본 5분. */
  timeout_ms?: number;
  /** 타임아웃 시 사용할 기본값. */
  fallback_value?: string;
}

// ── Approval Node ────────────────────────────────────

export interface ApprovalNodeDefinition extends NodeBase {
  node_type: "approval";
  /** 승인 요청 메시지 (템플릿 지원). */
  message: string;
  /** 전송 대상. */
  target: "origin" | "specified";
  channel?: string;
  chat_id?: string;
  /** 필요한 승인 수 (다중 승인자). 기본 1. */
  quorum?: number;
  /** 코멘트 필수 여부. */
  require_comment?: boolean;
  timeout_ms?: number;
}

// ── Form Node ────────────────────────────────────────

export interface FormFieldDefinition {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "boolean";
  required?: boolean;
  default_value?: string;
  options?: string[];
  placeholder?: string;
}

export interface FormNodeDefinition extends NodeBase {
  node_type: "form";
  /** 폼 제목. */
  title: string;
  /** 폼 설명. */
  description?: string;
  /** 전송 대상. */
  target: "origin" | "specified";
  channel?: string;
  chat_id?: string;
  /** 폼 필드 정의. */
  fields: FormFieldDefinition[];
  timeout_ms?: number;
}

// ── Tool Invoke Node ─────────────────────────────────

export interface ToolInvokeNodeDefinition extends NodeBase {
  node_type: "tool_invoke";
  /** 호출할 도구 ID (템플릿 지원). */
  tool_id: string;
  /** 도구 파라미터 (템플릿 지원). */
  params?: Record<string, unknown>;
  timeout_ms?: number;
}

// ── Gate Node ────────────────────────────────────────

export interface GateNodeDefinition extends NodeBase {
  node_type: "gate";
  /** 진행에 필요한 최소 완료 수. */
  quorum: number;
  timeout_ms?: number;
  /** 타임아웃 시 동작. */
  on_timeout?: "proceed" | "fail";
}

// ── Escalation Node ──────────────────────────────────

export type EscalationCondition = "always" | "on_timeout" | "on_rejection" | "custom";

export interface EscalationNodeDefinition extends NodeBase {
  node_type: "escalation";
  /** 에스컬레이션 조건. */
  condition: EscalationCondition;
  /** custom 조건 시 JS 표현식. */
  custom_expression?: string;
  /** 에스컬레이션 메시지 (템플릿 지원). */
  message: string;
  /** 에스컬레이션 대상 채널. */
  target_channel: string;
  target_chat_id?: string;
  /** 우선순위. */
  priority?: "critical" | "high" | "medium" | "low";
}

// ── Cache Node ───────────────────────────────────────

export interface CacheNodeDefinition extends NodeBase {
  node_type: "cache";
  /** 캐시 키 (템플릿 지원). */
  cache_key: string;
  /** TTL (ms). 기본 5분. */
  ttl_ms?: number;
  /** 연산 모드. */
  operation?: "get_or_set" | "invalidate";
}

// ── Retry Node ───────────────────────────────────────

export type BackoffStrategy = "exponential" | "linear" | "fixed";

export interface RetryNodeDefinition extends NodeBase {
  node_type: "retry";
  /** 재시도 대상 노드 ID. */
  target_node: string;
  /** 최대 시도 횟수. */
  max_attempts: number;
  /** 백오프 전략. */
  backoff?: BackoffStrategy;
  /** 초기 대기 시간 (ms). */
  initial_delay_ms?: number;
  /** 최대 대기 시간 (ms). */
  max_delay_ms?: number;
}

// ── Batch Node ───────────────────────────────────────

export interface BatchNodeDefinition extends NodeBase {
  node_type: "batch";
  /** 처리할 배열 필드 경로. */
  array_field: string;
  /** 각 아이템에 실행할 노드 ID. */
  body_node: string;
  /** 동시 실행 수. 기본 5. */
  concurrency?: number;
  /** 아이템 실패 시 동작. */
  on_item_error?: "continue" | "halt";
}

// ── Assert Node ──────────────────────────────────────

export interface AssertionDefinition {
  /** JS 표현식 (memory 컨텍스트). true면 통과. */
  condition: string;
  /** 실패 시 에러 메시지. */
  message?: string;
}

export interface AssertNodeDefinition extends NodeBase {
  node_type: "assert";
  /** 검증 조건 목록. */
  assertions: AssertionDefinition[];
  /** 실패 시 동작. halt: 워크플로우 중단, continue: 경고 후 진행. */
  on_fail?: "halt" | "continue";
  /** 전체 에러 메시지 (템플릿 지원). */
  error_message?: string;
}

// ── Webhook Node ─────────────────────────────────────

export interface WebhookNodeDefinition extends NodeBase {
  node_type: "webhook";
  /** 수신 경로 (예: /hooks/payment-callback). */
  path: string;
  /** 허용 HTTP 메서드. */
  http_method: "GET" | "POST" | "PUT" | "DELETE";
  /** 응답 모드. immediate: 즉시 200, wait: 워크플로우 완료 후 응답. */
  response_mode: "immediate" | "wait";
  /** 응답 상태 코드. */
  response_status?: number;
  /** 응답 바디 (템플릿 지원). */
  response_body?: string;
}

// ── Git Node ─────────────────────────────────────────

export interface GitNodeDefinition extends NodeBase {
  node_type: "git";
  /** Git 오퍼레이션 (status, diff, log, commit, push 등). */
  operation: string;
  /** 추가 인자 (템플릿 지원). */
  args?: string;
  /** 작업 디렉토리. */
  working_dir?: string;
}

// ── Shell Node ───────────────────────────────────────

export interface ShellNodeDefinition extends NodeBase {
  node_type: "shell";
  /** 실행할 쉘 명령 (템플릿 지원). */
  command: string;
  /** 작업 디렉토리. */
  working_dir?: string;
  /** 타임아웃 (ms). */
  timeout_ms?: number;
}

// ── Web Search Node ──────────────────────────────────

export interface WebSearchNodeDefinition extends NodeBase {
  node_type: "web_search";
  /** 검색 쿼리 (템플릿 지원). */
  query: string;
  /** 최대 결과 수. */
  max_results?: number;
  /** 검색 엔진. */
  search_engine?: string;
}

// ── Web Scrape Node ──────────────────────────────────

export interface WebScrapeNodeDefinition extends NodeBase {
  node_type: "web_scrape";
  /** 동작: scrape (기본) / robots_txt / sitemap. */
  action?: string;
  /** 스크래핑 URL (템플릿 지원). */
  url: string;
  /** CSS 셀렉터 힌트. */
  selector?: string;
  /** 최대 문자 수. */
  max_chars?: number;
}

// ── Archive Node ─────────────────────────────────────

export interface ArchiveNodeDefinition extends NodeBase {
  node_type: "archive";
  /** create / extract / list. */
  operation: string;
  /** 아카이브 포맷. */
  format?: "tar.gz" | "zip";
  /** 아카이브 파일 경로 (템플릿 지원). */
  archive_path: string;
  /** 포함할 파일/디렉토리 (create 시, 템플릿 지원). */
  files?: string;
  /** 추출 출력 디렉토리. */
  output_dir?: string;
}

// ── Process Node ─────────────────────────────────────

export interface ProcessNodeDefinition extends NodeBase {
  node_type: "process";
  /** list / start / stop / info. */
  operation: string;
  /** 시작할 명령 (start 시, 템플릿 지원). */
  command?: string;
  /** 프로세스 ID (stop/info 시). */
  pid?: number;
  /** 시그널 (stop 시). */
  signal?: string;
  /** 프로세스 이름 필터 (list 시). */
  filter?: string;
}

// ── Docker Node ──────────────────────────────────────

export interface DockerNodeDefinition extends NodeBase {
  node_type: "docker";
  /** ps / run / stop / rm / logs / exec / images / inspect. */
  operation: string;
  /** 컨테이너 이름/ID. */
  container?: string;
  /** 이미지 이름 (run 시). */
  image?: string;
  /** 컨테이너 내부 명령 (run/exec 시). */
  command?: string;
  /** 추가 docker 인자. */
  args?: string;
  /** 로그 줄 수 (logs 시). */
  tail?: number;
}

// ── Web Table Node ───────────────────────────────────

export interface WebTableNodeDefinition extends NodeBase {
  node_type: "web_table";
  /** 대상 URL (템플릿 지원). */
  url: string;
  /** 테이블 CSS 셀렉터 (기본: 'table'). */
  selector?: string;
  /** 최대 행 수. */
  max_rows?: number;
}

// ── Network Node ─────────────────────────────────────

export interface NetworkNodeDefinition extends NodeBase {
  node_type: "network";
  /** ping / dns / whois / port_check / http_head / netstat. */
  operation: string;
  /** 대상 호스트 (템플릿 지원). */
  host?: string;
  /** 포트 번호 (port_check 시). */
  port?: number;
  /** ping 횟수. */
  count?: number;
  /** dns 전용: lookup/mx/txt/ns/cname/srv/reverse/any. */
  dns_record_type?: string;
  /** dns lookup 전용: IP family (4 또는 6). */
  dns_family?: number;
}

// ── Web Form Node (Workflow) ─────────────────────────

export interface WebFormNodeDefinition extends NodeBase {
  node_type: "web_form";
  /** 폼 페이지 URL (템플릿 지원). */
  url: string;
  /** CSS 셀렉터 → 값 매핑. */
  fields: Record<string, unknown>;
  /** 제출 버튼 셀렉터. */
  submit_selector?: string;
  /** 제출 후 대기 (ms). */
  wait_after_ms?: number;
}

// ── System Info Node ─────────────────────────────────

export interface SystemInfoNodeDefinition extends NodeBase {
  node_type: "system_info";
  /** disk / memory / cpu / os / uptime / network / all. */
  category?: string;
}

// ── Package Manager Node ─────────────────────────────

export interface PackageManagerNodeDefinition extends NodeBase {
  node_type: "package_manager";
  /** list / install / uninstall / audit / outdated / info. */
  operation: string;
  /** npm / pip / cargo. */
  manager?: string;
  /** 패키지 이름. */
  package_name?: string;
  /** 추가 플래그. */
  flags?: string;
}

// ── DataFormat Node ─────────────────────────────────

export interface DataFormatNodeDefinition extends NodeBase {
  node_type: "data_format";
  /** convert / query / validate / pretty / flatten / unflatten / merge / pick / omit. */
  operation: string;
  input?: string;
  from?: string;
  to?: string;
  path?: string;
  keys?: string;
  input2?: string;
  delimiter?: string;
}

// ── Encoding Node ───────────────────────────────────

export interface EncodingNodeDefinition extends NodeBase {
  node_type: "encoding";
  /** encode / decode / hash / uuid / base_convert / msgpack_encode / msgpack_decode / protobuf_define / protobuf_encode / protobuf_decode / protobuf_to_proto. */
  operation: string;
  input?: string;
  /** base64 / hex / url / sha256 / sha512 / md5. */
  format?: string;
  count?: number;
  /** base_convert 전용: 변환 원본 진법 (bin/oct/dec/hex/base32/base36/base62). */
  base_from?: string;
  /** base_convert 전용: 변환 대상 진법. */
  base_to?: string;
  /** protobuf 전용: 메시지 정의 JSON ({name, fields}). */
  schema?: string;
}

// ── Regex Node ──────────────────────────────────────

export interface RegexNodeDefinition extends NodeBase {
  node_type: "regex";
  /** match / match_all / replace / extract / split / test / glob_test / glob_filter. */
  operation: string;
  input?: string;
  pattern?: string;
  flags?: string;
  replacement?: string;
}

// ── Diff Node ───────────────────────────────────────

export interface DiffNodeDefinition extends NodeBase {
  node_type: "diff";
  /** compare / patch / stats. */
  operation: string;
  old_text?: string;
  new_text?: string;
  diff_text?: string;
  context_lines?: number;
}

// ── Screenshot Node ─────────────────────────────────

export interface ScreenshotNodeDefinition extends NodeBase {
  node_type: "screenshot";
  url?: string;
  output_path?: string;
  selector?: string;
  full_page?: boolean;
  width?: number;
  height?: number;
  delay_ms?: number;
}

// ── Database Node ───────────────────────────────────

export interface DatabaseNodeDefinition extends NodeBase {
  node_type: "database";
  /** query / tables / schema / explain. */
  operation: string;
  datasource?: string;
  sql?: string;
  table?: string;
  max_rows?: number;
}

// ── TemplateEngine Node ─────────────────────────────

export interface TemplateEngineNodeDefinition extends NodeBase {
  node_type: "template_engine";
  template?: string;
  data?: string;
  partials?: string;
}

// ── Validator Node ──────────────────────────────────

export interface ValidatorNodeDefinition extends NodeBase {
  node_type: "validator";
  /** schema / format / rules / email. */
  operation: string;
  input?: string;
  format?: string;
  schema?: string;
  rules?: string;
  /** email operation 전용: EmailValidateTool action (validate/parse/normalize/check_disposable/check_free/bulk_validate). */
  email_action?: string;
}

// ── Queue Node ──────────────────────────────────────

export interface QueueNodeDefinition extends NodeBase {
  node_type: "queue";
  /** enqueue / dequeue / peek / size / drain / list / clear / delete. */
  operation: string;
  queue?: string;
  value?: string;
  mode?: string;
  priority?: number;
  count?: number;
}

// ── TTL Cache Node ──────────────────────────────────

export interface TtlCacheNodeDefinition extends NodeBase {
  node_type: "ttl_cache";
  /** set / get / invalidate / has / keys / stats / clear. */
  operation: string;
  key?: string;
  value?: string;
  ttl_ms?: number;
}

// ── Image Node ──────────────────────────────────────

export interface ImageNodeDefinition extends NodeBase {
  node_type: "image";
  /** resize / crop / rotate / convert / info / thumbnail. */
  operation: string;
  input_path?: string;
  output_path?: string;
  width?: number;
  height?: number;
  angle?: number;
  format?: string;
  quality?: number;
  gravity?: string;
}

// ── Media Node ──────────────────────────────────────

export interface MediaNodeDefinition extends NodeBase {
  node_type: "media";
  /** detect_type / extract_metadata / transcode / generate_thumbnail / to_base64 / from_base64. */
  operation: string;
  input_path?: string;
  output_path?: string;
  /** 변환 대상 포맷 (transcode). */
  target_format?: string;
  /** 썸네일 크기 (generate_thumbnail). */
  thumb_width?: number;
  thumb_height?: number;
  /** base64 인코딩/디코딩 시 MIME 타입. */
  mime_type?: string;
}

// ── Stats Node ──────────────────────────────────────

export interface StatsNodeDefinition extends NodeBase {
  node_type: "stats";
  /** summary / percentile / histogram / correlation / normalize / outliers. */
  operation: string;
  data?: string;
  data2?: string;
  percentile?: number;
  bins?: number;
  threshold?: number;
}

// ── Text Node ───────────────────────────────────────

export interface TextNodeDefinition extends NodeBase {
  node_type: "text";
  /** upper/lower/title/camel/snake/kebab/slugify/filename_safe/transliterate/truncate/pad/count/dedup/similarity/reverse/join/wrap/trim_lines. */
  operation: string;
  input?: string;
  input2?: string;
  max_length?: number;
  width?: number;
}

// ── Compress Node ───────────────────────────────────

export interface CompressNodeDefinition extends NodeBase {
  node_type: "compress";
  /** compress / decompress / compress_string / decompress_string. */
  operation: string;
  input_path?: string;
  output_path?: string;
  input?: string;
  algorithm?: string;
  level?: number;
}

// ── Math Node ───────────────────────────────────────

export interface MathNodeDefinition extends NodeBase {
  node_type: "math";
  /** eval/convert/compound_interest/loan_payment/roi/percentage/round/gcd/lcm/factorial/fibonacci/currency. */
  operation: string;
  expression?: string;
  value?: number;
  from?: string;
  to?: string;
  principal?: number;
  rate?: number;
  periods?: number;
  cost?: number;
  gain?: number;
  decimals?: number;
  a?: number;
  b?: number;
  n?: number;
  /** currency 전용: info/format/convert/list/compare/parse. */
  currency_action?: string;
  currency_code?: string;
  currency_from?: string;
  currency_to?: string;
  currency_amount?: number;
}

// ── Table Node ──────────────────────────────────────

export interface TableNodeDefinition extends NodeBase {
  node_type: "table";
  /** sort/filter/group_by/join/pivot/aggregate/distinct/slice/pluck/count_by. */
  operation: string;
  data?: string;
  data2?: string;
  field?: string;
  fields?: string;
  order?: string;
  condition?: string;
  join_field?: string;
  join_type?: string;
  agg?: string;
  value_field?: string;
  start?: number;
  end?: number;
}

// ── Eval Node ───────────────────────────────────────

export interface EvalNodeDefinition extends NodeBase {
  node_type: "eval";
  code?: string;
  context?: string;
}

// ── DateCalc Node ───────────────────────────────────

export interface DateCalcNodeDefinition extends NodeBase {
  node_type: "date_calc";
  /** now/add/diff/timezone/business_days/format/parse/day_info/range. */
  operation: string;
  date?: string;
  date2?: string;
  amount?: number;
  unit?: string;
  from_tz?: string;
  to_tz?: string;
  format?: string;
  start_date?: string;
  end_date?: string;
  step_days?: number;
}

// ── Format Node ─────────────────────────────────────

export interface FormatNodeDefinition extends NodeBase {
  node_type: "format";
  /** number/currency/percent/bytes/relative_time/mask/ordinal/plural/duration/pad/truncate. */
  operation: string;
  value?: string;
  locale?: string;
  currency?: string;
  decimals?: number;
  mask_type?: string;
  mask_char?: string;
  word?: string;
  plural_word?: string;
  width?: number;
  fill?: string;
  align?: string;
  max_length?: number;
  suffix?: string;
}

// ── SetOps Node ─────────────────────────────────────

export interface SetOpsNodeDefinition extends NodeBase {
  node_type: "set_ops";
  /** union/intersection/difference/symmetric_difference/is_subset/is_superset/equals/power_set/cartesian_product. */
  operation: string;
  a?: string;
  b?: string;
}

// ── Lookup Node ─────────────────────────────────────

export interface LookupNodeDefinition extends NodeBase {
  node_type: "lookup";
  /** http_status/mime_type/country/currency_symbol. */
  table: string;
  key?: string;
  reverse?: boolean;
  list?: boolean;
}

// ── Markdown Node ───────────────────────────────────

export interface MarkdownNodeDefinition extends NodeBase {
  node_type: "markdown";
  /** table/list/checklist/toc/html_to_md/badge/link/image/code_block/details/task_list. */
  operation: string;
  data?: string;
  text?: string;
  columns?: string;
  align?: string;
  ordered?: boolean;
  label?: string;
  url?: string;
  color?: string;
  alt?: string;
  language?: string;
  code?: string;
  summary?: string;
}

// ── End (Output) Node ───────────────────────────────

export type EndOutputTarget = "channel" | "media" | "webhook" | "http";

export interface EndNodeDefinition extends NodeBase {
  node_type: "end";
  /** 선택된 아웃바운드 대상 목록. */
  output_targets: EndOutputTarget[];
  /** 각 대상별 추가 설정. */
  target_config?: Record<string, Record<string, unknown>>;
}

export interface HashNodeDefinition extends NodeBase {
  node_type: "hash";
  action?: string;
  input?: string;
  algorithm?: string;
  key?: string;
  encoding?: string;
  expected?: string;
}

export interface CryptoNodeDefinition extends NodeBase {
  node_type: "crypto";
  action?: string;
  input?: string;
  key?: string;
}

export interface JwtNodeDefinition extends NodeBase {
  node_type: "jwt";
  action?: string;
  token?: string;
  secret?: string;
  payload?: string;
  algorithm?: string;
  expires_in?: string;
}

export interface GraphqlNodeDefinition extends NodeBase {
  node_type: "graphql";
  url?: string;
  query?: string;
  variables?: string;
  headers?: string;
  operation_name?: string;
}

export interface EmailNodeDefinition extends NodeBase {
  node_type: "email";
  action?: string;
  to?: string;
  from?: string;
  subject?: string;
  body?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
}

export interface DiagramNodeDefinition extends NodeBase {
  node_type: "diagram";
  source?: string;
  type?: string;
  output_format?: string;
}

export interface MemoryRwNodeDefinition extends NodeBase {
  node_type: "memory_rw";
  action?: string;
  key?: string;
  value?: string;
}

export interface SecretReadNodeDefinition extends NodeBase {
  node_type: "secret_read";
  key?: string;
  namespace?: string;
}

// ── CSV Node ────────────────────────────────────────

export interface CsvNodeDefinition extends NodeBase {
  node_type: "csv";
  action?: string;
  data?: string;
  delimiter?: string;
  has_header?: boolean;
  columns?: string;
}

// ── WebSocket Node ──────────────────────────────────

export interface WebSocketNodeDefinition extends NodeBase {
  node_type: "websocket";
  action?: string;
  url?: string;
  id?: string;
  message?: string;
  timeout_ms?: number;
}

// ── PDF Node ────────────────────────────────────────

export interface PdfNodeDefinition extends NodeBase {
  node_type: "pdf";
  action?: string;
  path?: string;
  pages?: string;
  max_chars?: number;
}

// ── Rate Limit Node ─────────────────────────────────

export interface RateLimitNodeDefinition extends NodeBase {
  node_type: "rate_limit";
  action?: string;
  key?: string;
  max_requests?: number;
  window_ms?: number;
}

// ── XML Node ────────────────────────────────────────

export interface XmlNodeDefinition extends NodeBase {
  node_type: "xml";
  action?: string;
  data?: string;
  path?: string;
}

// ── YAML Node ───────────────────────────────────────

export interface YamlNodeDefinition extends NodeBase {
  node_type: "yaml";
  action?: string;
  /** yaml (기본) | toml. */
  format?: string;
  data?: string;
  data2?: string;
  path?: string;
  indent?: number;
}

// ── FTP Node ────────────────────────────────────────

export interface FtpNodeDefinition extends NodeBase {
  node_type: "ftp";
  action?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  remote_path?: string;
}

// ── SSH Node ────────────────────────────────────────

export interface SshNodeDefinition extends NodeBase {
  node_type: "ssh";
  action?: string;
  host?: string;
  command?: string;
  port?: number;
  identity_file?: string;
  timeout_ms?: number;
}

// ── S3 Node ─────────────────────────────────────────

export interface S3NodeDefinition extends NodeBase {
  node_type: "s3";
  action?: string;
  bucket?: string;
  key?: string;
  region?: string;
  endpoint?: string;
  access_key?: string;
  secret_key?: string;
  prefix?: string;
}

// ── HTML Node ───────────────────────────────────────

export interface HtmlNodeDefinition extends NodeBase {
  node_type: "html";
  action?: string;
  html?: string;
  selector?: string;
}

// ── QR Node ─────────────────────────────────────────

export interface QrNodeDefinition extends NodeBase {
  node_type: "qr";
  action?: string;
  data?: string;
  format?: string;
  size?: number;
}

// ── MQTT Node ───────────────────────────────────────

export interface MqttNodeDefinition extends NodeBase {
  node_type: "mqtt";
  action?: string;
  host?: string;
  port?: number;
  topic?: string;
  message?: string;
  username?: string;
  password?: string;
  qos?: number;
}

// ── Redis Node ──────────────────────────────────────

export interface RedisNodeDefinition extends NodeBase {
  node_type: "redis";
  action?: string;
  host?: string;
  port?: number;
  key?: string;
  value?: string;
  field?: string;
  password?: string;
  ttl?: number;
}

// ── SQL Builder Node ────────────────────────────────

export interface SqlBuilderNodeDefinition extends NodeBase {
  node_type: "sql_builder";
  action?: string;
  table?: string;
  columns?: string;
  where?: string;
  values?: string;
  order_by?: string;
  limit?: number;
  dialect?: string;
}

// ── Log Parser Node ─────────────────────────────────

export interface LogParserNodeDefinition extends NodeBase {
  node_type: "log_parser";
  action?: string;
  input?: string;
  pattern?: string;
  field?: string;
  value?: string;
  level?: string;
}

// ── RSS Node ────────────────────────────────────────

export interface RssNodeDefinition extends NodeBase {
  node_type: "rss";
  action?: string;
  url?: string;
  input?: string;
  feed_title?: string;
  link?: string;
  items?: string;
}

// ── Duration Node ───────────────────────────────────

export interface DurationNodeDefinition extends NodeBase {
  node_type: "duration";
  action?: string;
  duration?: string;
  duration2?: string;
  ms?: number;
}

// ── LDAP Node ───────────────────────────────────────

export interface LdapNodeDefinition extends NodeBase {
  node_type: "ldap";
  action?: string;
  host?: string;
  port?: number;
  bind_dn?: string;
  password?: string;
  base_dn?: string;
  filter?: string;
  scope?: string;
}

// ── JSON Schema Node ────────────────────────────────

export interface JsonSchemaNodeDefinition extends NodeBase {
  node_type: "json_schema";
  action?: string;
  schema?: string;
  data?: string;
  target_draft?: string;
  schema2?: string;
}

// ── OpenAPI Node ────────────────────────────────────

export interface OpenApiNodeDefinition extends NodeBase {
  node_type: "openapi";
  action?: string;
  spec?: string;
  path?: string;
  method?: string;
  language?: string;
}

// ── Barcode Node ────────────────────────────────────

export interface BarcodeNodeDefinition extends NodeBase {
  node_type: "barcode";
  action?: string;
  data?: string;
  format?: string;
  width?: number;
  height?: number;
}

// ── Phone Node ──────────────────────────────────────

export interface PhoneNodeDefinition extends NodeBase {
  node_type: "phone";
  action?: string;
  number?: string;
  number2?: string;
  country?: string;
  format_type?: string;
}

// ── Healthcheck Node ────────────────────────────────

export interface HealthcheckNodeDefinition extends NodeBase {
  node_type: "healthcheck";
  action?: string;
  url?: string;
  host?: string;
  port?: number;
  timeout_ms?: number;
  expected_status?: number;
  endpoints?: string;
}

// ── Cookie Node ─────────────────────────────────────

export interface CookieNodeDefinition extends NodeBase {
  node_type: "cookie";
  action?: string;
  input?: string;
  cookie_name?: string;
  cookie_value?: string;
}

// ── Password Node ───────────────────────────────────

export interface PasswordNodeDefinition extends NodeBase {
  node_type: "password";
  action?: string;
  password_input?: string;
  length?: number;
  hash?: string;
}

// ── Changelog Node ──────────────────────────────────

export interface ChangelogNodeDefinition extends NodeBase {
  node_type: "changelog";
  action?: string;
  commits?: string;
  version?: string;
  commit_message?: string;
}

// ── Matrix Node ─────────────────────────────────────

export interface MatrixNodeDefinition extends NodeBase {
  node_type: "matrix";
  action?: string;
  a?: string;
  b?: string;
  scalar?: number;
  size?: number;
}

// ── StateMachine Node ───────────────────────────────

export interface StateMachineNodeDefinition extends NodeBase {
  node_type: "state_machine";
  action?: string;
  machine?: string;
  current?: string;
  event?: string;
  events?: string;
}

// ── CodeDiagram Node ────────────────────────────────

export interface CodeDiagramNodeDefinition extends NodeBase {
  node_type: "code_diagram";
  action?: string;
  source?: string;
  sources?: string;
  function_name?: string;
  direction?: string;
  show_private?: boolean;
  group_by_folder?: boolean;
  actors?: string;
  messages?: string;
}

// ── Graph Node ──────────────────────────────────────

export interface GraphNodeDefinition extends NodeBase {
  node_type: "graph";
  action?: string;
  edges?: string;
  start?: string;
  end_node?: string;
}

// ── Tokenizer Node ──────────────────────────────────

export interface TokenizerNodeDefinition extends NodeBase {
  node_type: "tokenizer";
  action?: string;
  text?: string;
  n?: number;
  top_k?: number;
}

// ── Similarity Node ─────────────────────────────────

export interface SimilarityNodeDefinition extends NodeBase {
  node_type: "similarity";
  action?: string;
  a?: string;
  b?: string;
  mode?: string;
}

// ── DataMask Node ───────────────────────────────────

export interface DataMaskNodeDefinition extends NodeBase {
  node_type: "data_mask";
  action?: string;
  text?: string;
  pattern?: string;
  replacement?: string;
}

// ── CircuitBreaker Node ─────────────────────────────

export interface CircuitBreakerNodeDefinition extends NodeBase {
  node_type: "circuit_breaker";
  action?: string;
  name?: string;
  threshold?: number;
  timeout_ms?: number;
  half_open_max?: number;
}

export interface DocumentPdfNodeDefinition extends NodeBase {
  node_type: "document_pdf";
  content?: string;
  input_format?: string;
  output?: string;
}

export interface DocumentDocxNodeDefinition extends NodeBase {
  node_type: "document_docx";
  content?: string;
  input_format?: string;
  output?: string;
}

export interface DocumentXlsxNodeDefinition extends NodeBase {
  node_type: "document_xlsx";
  content?: string;
  output?: string;
  delimiter?: string;
}

export interface DocumentPptxNodeDefinition extends NodeBase {
  node_type: "document_pptx";
  content?: string;
  output?: string;
  slide_format?: string;
}


export interface UrlNodeDefinition extends NodeBase {
  node_type: "url";
  /** parse / build / resolve / encode / decode / query_params / join / normalize. */
  action?: string;
  url?: string;
  base?: string;
  params?: string;
  parts?: string;
  segments?: string;
  component?: string;
}

export interface RandomNodeDefinition extends NodeBase {
  node_type: "random";
  /** integer / float / choice / shuffle / sample / password / bytes / coin / dice. */
  action?: string;
  min?: number;
  max?: number;
  items?: string;
  count?: number;
  length?: number;
  charset?: string;
  sides?: number;
}

export interface SemverNodeDefinition extends NodeBase {
  node_type: "semver";
  /** parse / compare / satisfies / bump / sort / diff / valid. */
  action?: string;
  version?: string;
  version2?: string;
  range?: string;
  bump_type?: string;
  versions?: string;
}

export interface ColorNodeDefinition extends NodeBase {
  node_type: "color";
  /** parse / convert / blend / contrast / lighten / darken / palette / complement. */
  action?: string;
  color?: string;
  color2?: string;
  format?: string;
  amount?: number;
  count?: number;
}


// ── Union Types ─────────────────────────────────────

export type OrcheNodeType = "http" | "code" | "if" | "merge" | "set" | "split"
  | "llm" | "switch" | "wait" | "template" | "oauth" | "sub_workflow"
  | "filter" | "loop" | "transform" | "db" | "file"
  | "analyzer" | "retriever" | "ai_agent" | "text_splitter"
  | "task" | "spawn_agent" | "decision" | "promise"
  | "embedding" | "vector_store"
  | "notify" | "aggregate" | "send_file" | "error_handler" | "webhook"
  | "hitl" | "approval" | "form" | "tool_invoke" | "gate" | "escalation"
  | "cache" | "retry" | "batch" | "assert"
  | "git" | "shell" | "web_search" | "web_scrape" | "archive" | "process"
  | "docker" | "web_table" | "network" | "web_form" | "system_info" | "package_manager"
  | "data_format" | "encoding" | "regex" | "diff" | "screenshot" | "database"
  | "template_engine" | "validator" | "queue" | "ttl_cache"
  | "image" | "stats" | "text" | "compress"
  | "math" | "table" | "eval" | "date_calc" | "format" | "set_ops" | "lookup" | "markdown"
  | "media" | "hash" | "crypto" | "jwt" | "graphql" | "email"
  | "diagram" | "memory_rw" | "secret_read"
  | "csv" | "websocket" | "pdf" | "rate_limit" | "xml" | "yaml" | "ftp"
  | "ssh" | "s3" | "html" | "qr" | "mqtt" | "redis"
  | "sql_builder" | "log_parser" | "rss" | "duration" | "ldap"
  | "json_schema" | "openapi" | "barcode" | "phone" | "healthcheck"
  | "cookie" | "password" | "changelog" | "matrix" | "state_machine"
  | "code_diagram"
  | "graph" | "tokenizer" | "similarity" | "data_mask" | "circuit_breaker"
  | "document_pdf"
  | "document_docx"
  | "document_xlsx"
  | "document_pptx"
  | "url"
  | "random"
  | "semver"
  | "color"
  | "end";

export type OrcheNodeDefinition =
  | HttpNodeDefinition
  | CodeNodeDefinition
  | IfNodeDefinition
  | MergeNodeDefinition
  | SetNodeDefinition
  | SplitNodeDefinition
  | LlmNodeDefinition
  | SwitchNodeDefinition
  | WaitNodeDefinition
  | TemplateNodeDefinition
  | OauthNodeDefinition
  | SubWorkflowNodeDefinition
  | FilterNodeDefinition
  | LoopNodeDefinition
  | TransformNodeDefinition
  | DbNodeDefinition
  | FileNodeDefinition
  | AnalyzerNodeDefinition
  | RetrieverNodeDefinition
  | AiAgentNodeDefinition
  | TextSplitterNodeDefinition
  | TaskNodeDefinition
  | SpawnAgentNodeDefinition
  | DecisionNodeDefinition
  | PromiseNodeDefinition
  | EmbeddingNodeDefinition
  | VectorStoreNodeDefinition
  | NotifyNodeDefinition
  | AggregateNodeDefinition
  | SendFileNodeDefinition
  | ErrorHandlerNodeDefinition
  | WebhookNodeDefinition
  | HitlNodeDefinition
  | ApprovalNodeDefinition
  | FormNodeDefinition
  | ToolInvokeNodeDefinition
  | GateNodeDefinition
  | EscalationNodeDefinition
  | CacheNodeDefinition
  | RetryNodeDefinition
  | BatchNodeDefinition
  | AssertNodeDefinition
  | GitNodeDefinition
  | ShellNodeDefinition
  | WebSearchNodeDefinition
  | WebScrapeNodeDefinition
  | ArchiveNodeDefinition
  | ProcessNodeDefinition
  | DockerNodeDefinition
  | WebTableNodeDefinition
  | NetworkNodeDefinition
  | WebFormNodeDefinition
  | SystemInfoNodeDefinition
  | PackageManagerNodeDefinition
  | DataFormatNodeDefinition
  | EncodingNodeDefinition
  | RegexNodeDefinition
  | DiffNodeDefinition
  | ScreenshotNodeDefinition
  | DatabaseNodeDefinition
  | TemplateEngineNodeDefinition
  | ValidatorNodeDefinition
  | QueueNodeDefinition
  | TtlCacheNodeDefinition
  | ImageNodeDefinition
  | MediaNodeDefinition
  | StatsNodeDefinition
  | TextNodeDefinition
  | CompressNodeDefinition
  | MathNodeDefinition
  | TableNodeDefinition
  | EvalNodeDefinition
  | DateCalcNodeDefinition
  | FormatNodeDefinition
  | SetOpsNodeDefinition
  | LookupNodeDefinition
  | MarkdownNodeDefinition
  | HashNodeDefinition
  | CryptoNodeDefinition
  | JwtNodeDefinition
  | GraphqlNodeDefinition
  | EmailNodeDefinition
  | DiagramNodeDefinition
  | MemoryRwNodeDefinition
  | SecretReadNodeDefinition
  | CsvNodeDefinition
  | WebSocketNodeDefinition
  | PdfNodeDefinition
  | RateLimitNodeDefinition
  | XmlNodeDefinition
  | YamlNodeDefinition
  | FtpNodeDefinition
  | SshNodeDefinition
  | S3NodeDefinition
  | HtmlNodeDefinition
  | QrNodeDefinition
  | MqttNodeDefinition
  | RedisNodeDefinition
  | SqlBuilderNodeDefinition
  | LogParserNodeDefinition
  | RssNodeDefinition
  | DurationNodeDefinition
  | LdapNodeDefinition
  | JsonSchemaNodeDefinition
  | OpenApiNodeDefinition
  | BarcodeNodeDefinition
  | PhoneNodeDefinition
  | HealthcheckNodeDefinition
  | CookieNodeDefinition
  | PasswordNodeDefinition
  | ChangelogNodeDefinition
  | MatrixNodeDefinition
  | StateMachineNodeDefinition
  | CodeDiagramNodeDefinition
  | GraphNodeDefinition
  | TokenizerNodeDefinition
  | SimilarityNodeDefinition
  | DataMaskNodeDefinition
  | CircuitBreakerNodeDefinition
  | DocumentPdfNodeDefinition
  | DocumentDocxNodeDefinition
  | DocumentXlsxNodeDefinition
  | DocumentPptxNodeDefinition
  | UrlNodeDefinition
  | RandomNodeDefinition
  | SemverNodeDefinition
  | ColorNodeDefinition
  | EndNodeDefinition;

export type WorkflowNodeDefinition = PhaseNodeDefinition | OrcheNodeDefinition | TriggerNodeDefinition;

// ── Orche Node State ────────────────────────────────

export type OrcheNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface OrcheNodeState {
  node_id: string;
  node_type: OrcheNodeType;
  status: OrcheNodeStatus;
  result?: unknown;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

// ── Normalizer ──────────────────────────────────────

/** PhaseDefinition → PhaseNodeDefinition 변환. */
export function phase_to_node(p: PhaseDefinition): PhaseNodeDefinition {
  return {
    node_type: "phase",
    node_id: p.phase_id,
    title: p.title,
    agents: p.agents,
    critic: p.critic,
    context_template: p.context_template,
    failure_policy: p.failure_policy,
    quorum_count: p.quorum_count,
    mode: p.mode,
    loop_until: p.loop_until,
    max_loop_iterations: p.max_loop_iterations,
    depends_on: p.depends_on,
    tools: p.tools,
    skills: p.skills,
  };
}

/** PhaseNodeDefinition → PhaseDefinition 역변환. */
export function node_to_phase(n: PhaseNodeDefinition): PhaseDefinition {
  return {
    phase_id: n.node_id,
    title: n.title,
    agents: n.agents,
    critic: n.critic,
    context_template: n.context_template,
    failure_policy: n.failure_policy,
    quorum_count: n.quorum_count,
    mode: n.mode,
    loop_until: n.loop_until,
    max_loop_iterations: n.max_loop_iterations,
    depends_on: n.depends_on,
    tools: n.tools,
    skills: n.skills,
  };
}

export interface NormalizedWorkflow {
  nodes: WorkflowNodeDefinition[];
  phase_defs: PhaseDefinition[];
}

/**
 * WorkflowDefinition의 nodes[] 또는 phases[]를 통합된 노드 배열로 정규화.
 * nodes[]가 있으면 우선 사용, 없으면 phases[]를 PhaseNodeDefinition으로 변환.
 */
export function normalize_workflow(def: {
  nodes?: WorkflowNodeDefinition[];
  phases?: PhaseDefinition[];
}): NormalizedWorkflow {
  if (def.nodes?.length) {
    const sorted = topological_sort(def.nodes);
    const phase_defs = sorted
      .filter((n): n is PhaseNodeDefinition => n.node_type === "phase")
      .map(node_to_phase);
    return { nodes: sorted, phase_defs };
  }
  const phases = def.phases || [];
  return {
    nodes: phases.map(phase_to_node),
    phase_defs: phases,
  };
}

/** depends_on 기반 토폴로지 정렬. 순환이 있으면 원본 순서 유지. */
function topological_sort(nodes: WorkflowNodeDefinition[]): WorkflowNodeDefinition[] {
  const id_to_node = new Map<string, WorkflowNodeDefinition>();
  for (const n of nodes) id_to_node.set(n.node_id, n);

  const in_degree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    in_degree.set(n.node_id, 0);
    dependents.set(n.node_id, []);
  }
  for (const n of nodes) {
    for (const dep of n.depends_on ?? []) {
      if (id_to_node.has(dep)) {
        in_degree.set(n.node_id, (in_degree.get(n.node_id) ?? 0) + 1);
        dependents.get(dep)!.push(n.node_id);
      }
    }
  }

  // Kahn's algorithm — 안정 정렬 (원본 순서 유지)
  const order_map = new Map(nodes.map((n, i) => [n.node_id, i]));
  const queue = nodes
    .filter((n) => (in_degree.get(n.node_id) ?? 0) === 0)
    .map((n) => n.node_id);
  const sorted: WorkflowNodeDefinition[] = [];

  while (queue.length > 0) {
    // 원본 순서가 앞선 노드를 우선 선택
    queue.sort((a, b) => (order_map.get(a) ?? 0) - (order_map.get(b) ?? 0));
    const id = queue.shift()!;
    sorted.push(id_to_node.get(id)!);
    for (const dep_id of dependents.get(id) ?? []) {
      const deg = (in_degree.get(dep_id) ?? 1) - 1;
      in_degree.set(dep_id, deg);
      if (deg === 0) queue.push(dep_id);
    }
  }

  // 순환 감지: 정렬 결과가 전체를 포함하지 못하면 원본 반환
  if (sorted.length < nodes.length) return nodes;
  return sorted;
}

/** 노드가 오케스트레이션 노드인지 확인. */
export function is_orche_node(node: WorkflowNodeDefinition): node is OrcheNodeDefinition {
  return node.node_type !== "phase" && node.node_type !== "trigger";
}
