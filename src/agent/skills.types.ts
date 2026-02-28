export type SkillSource = "builtin_skills" | "workspace_skills";

export type SkillMetadata = {
  name: string;
  path: string;
  source: SkillSource;
  always: boolean;
  summary: string;
  aliases: string[];
  triggers: string[];
  tools: string[];
  requirements: string[];
  model: string | null;
  frontmatter: Record<string, unknown>;
};

