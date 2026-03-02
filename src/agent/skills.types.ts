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
};

