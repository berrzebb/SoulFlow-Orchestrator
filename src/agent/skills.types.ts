export type SkillSource = "builtin_skills" | "workspace_skills" | "workspace_commands";
export type SkillType = "tool" | "role";

export type SkillMetadata = {
  name: string;
  path: string;
  source: SkillSource;
  type: SkillType;
  always: boolean;
  summary: string;
  aliases: string[];
  triggers: string[];
  tools: string[];
  requirements: string[];
  model: string | null;
  frontmatter: Record<string, unknown>;
  /** persona 역할명 매핑. type === "role" 일 때만 값이 존재. */
  role: string | null;
  /** 역할 페르소나 — 성격/캐릭터. */
  soul: string | null;
  /** 역할 페르소나 — 행동 양식/어투. */
  heart: string | null;
  /** _shared/ 프로토콜 문서명 목록. */
  shared_protocols: string[];
  /** 선호 프로바이더 instance_id 또는 provider_type 목록 (우선순위 순). */
  preferred_providers: string[];
  /** 필요한 OAuth 연동 서비스 ID 목록 (e.g., ["github", "google"]). */
  oauth: string[];
  /** 의도 분류 레이블 (e.g., ["generate_document"]). SkillIndex 4차원 매칭용. */
  intents: string[];
  /** 파일 확장자 패턴 (e.g., ["*.pdf", "*.pptx"]). */
  file_patterns: string[];
  /** 코드 키워드/라이브러리 (e.g., ["python", "pandas"]). */
  code_patterns: string[];
  /** 완료 체크 질문 목록 — CompletionChecker가 수집. */
  checks: string[];
  /** 프로젝트 문서 프로토콜 활성화 여부. */
  project_docs: boolean;
};

