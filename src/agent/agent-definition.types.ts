/**
 * AgentDefinition — DB에 저장되는 에이전트 정의 템플릿.
 * SKILL.md frontmatter와 동일한 구조로 설계되어, 레이어 합성으로 시스템 프롬프트를 생성.
 * 런타임 인스턴스(실행 중인 에이전트)와 분리된 개념.
 */

/** DB 저장 에이전트 정의. SKILL.md frontmatter equivalent. */
export type AgentDefinition = {
  id: string;
  name: string;
  /** "Use when X." 형식의 한 줄 설명. */
  description: string;
  /** 이모지 아이콘. */
  icon: string;

  // ── SKILL.md frontmatter 대응 필드 ──
  /** 기반 role skill 이름 (e.g., "role:pm"). null이면 커스텀 역할. */
  role_skill: string | null;
  /** 페르소나 — 성격/캐릭터. */
  soul: string;
  /** 페르소나 — 행동 양식/어투. */
  heart: string;
  /** 허용 도구 ID 목록. role_skill 기본값에서 사용자가 조정. */
  tools: string[];
  /** 포함할 _shared/ 프로토콜 이름 목록. 공통 규칙 체계. */
  shared_protocols: string[];
  /** 추가 tool-type skill 이름 목록. */
  skills: string[];

  // ── 경계 정의 ──
  /** 이 에이전트를 사용해야 할 상황. "Use when..." */
  use_when: string;
  /** 이 에이전트를 사용하면 안 되는 영역. "Do NOT use for..." */
  not_use_for: string;
  /** 공통 레이어 위에 추가되는 커스텀 지시사항. */
  extra_instructions: string;

  // ── 실행 설정 ──
  /** 선호 프로바이더 instance_id 목록 (우선순위 순). */
  preferred_providers: string[];
  /** 선호 모델명. 미설정 시 프로바이더 기본값 사용. */
  model: string | null;

  /** true = 시스템 제공 읽기 전용. false = 사용자 생성. */
  is_builtin: boolean;
  /** 이 정의로 에이전트를 시작한 횟수. */
  use_count: number;
  /** 3-tier scope: 'global' | 'team' | 'personal'. */
  scope_type: string;
  /** scope 대상 ID: team_id 또는 user_id. global이면 ''. */
  scope_id: string;
  created_at: string;
  updated_at: string;
};

/** 새 AgentDefinition 생성 입력. id, use_count, timestamps 제외. scope는 생략 시 global 기본값. */
export type CreateAgentDefinitionInput = Omit<
  AgentDefinition,
  "id" | "use_count" | "created_at" | "updated_at" | "scope_type" | "scope_id"
> & { scope_type?: string; scope_id?: string };

/** AgentDefinition 수정 입력. is_builtin, use_count, timestamps 변경 불가. */
export type UpdateAgentDefinitionInput = Partial<
  Omit<AgentDefinition, "id" | "is_builtin" | "use_count" | "created_at" | "updated_at">
>;

/** AI 자동 생성 요청. */
export type GenerateAgentDefinitionInput = {
  /** 자연어로 설명한 에이전트 역할. */
  prompt: string;
};

/** AI 생성 결과 — 사용자가 검토 후 저장할 필드들. timestamps/id 제외. */
export type GeneratedAgentFields = Pick<
  AgentDefinition,
  | "name"
  | "description"
  | "icon"
  | "role_skill"
  | "soul"
  | "heart"
  | "tools"
  | "shared_protocols"
  | "skills"
  | "use_when"
  | "not_use_for"
  | "extra_instructions"
  | "preferred_providers"
  | "model"
>;
