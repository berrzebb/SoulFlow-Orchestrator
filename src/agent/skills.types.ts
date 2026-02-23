export type SkillSource = "builtin_skills" | "workspace_skills";

export type SkillMetadata = {
  name: string;
  path: string;
  source: SkillSource;
  always: boolean;
  summary: string;
  requirements: string[];
  frontmatter: Record<string, unknown>;
};

