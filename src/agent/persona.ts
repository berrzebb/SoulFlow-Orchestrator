import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";

export type RolePersona = {
  role: string;
  soul: string;
  heart: string;
  body: string;
};

/** agents/*.md 파일 본문에서 ## Soul, ## Heart 섹션을 추출하고 나머지를 body로 반환. */
export function parse_role_persona(role: string, content: string): RolePersona {
  const raw = String(content || "").trim();
  if (!raw) return { role, soul: "", heart: "", body: "" };

  let soul = "";
  let heart = "";
  const body_lines: string[] = [];

  const sections = split_sections(raw);
  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    if (heading === "soul") {
      soul = section.content.trim();
    } else if (heading === "heart") {
      heart = section.content.trim();
    } else {
      const prefix = section.heading ? `## ${section.heading}\n` : "";
      body_lines.push(`${prefix}${section.content}`.trimEnd());
    }
  }

  return { role, soul, heart, body: body_lines.join("\n\n").trim() };
}

type Section = { heading: string; content: string };

function split_sections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current_heading = "";
  let current_lines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (current_heading || current_lines.length > 0) {
        sections.push({ heading: current_heading, content: current_lines.join("\n") });
      }
      current_heading = match[1].trim();
      current_lines = [];
    } else {
      current_lines.push(line);
    }
  }
  if (current_heading || current_lines.length > 0) {
    sections.push({ heading: current_heading, content: current_lines.join("\n") });
  }

  return sections;
}

/** 별도 파일 우선, 인라인 fallback. agents_dir 내의 {role}.md에서 persona를 로드. */
export async function load_role_persona(agents_dir: string, role: string): Promise<RolePersona | null> {
  const role_file = join(agents_dir, `${role}.md`);
  if (!existsSync(role_file)) return null;

  const content = (await readFile(role_file, "utf-8")).trim();
  const parsed = parse_role_persona(role, content);

  const soul_file = join(agents_dir, `${role}.soul.md`);
  const heart_file = join(agents_dir, `${role}.heart.md`);

  if (existsSync(soul_file)) {
    parsed.soul = (await readFile(soul_file, "utf-8")).trim();
  }
  if (existsSync(heart_file)) {
    parsed.heart = (await readFile(heart_file, "utf-8")).trim();
  }

  return parsed;
}

/** agents/ 디렉토리의 모든 .md를 파싱하여 role → RolePersona 맵을 구축. */
export async function load_all_personas(agents_dir: string): Promise<Map<string, RolePersona>> {
  const { readdirSync } = await import("node:fs");
  const map = new Map<string, RolePersona>();
  if (!existsSync(agents_dir)) return map;

  const files = readdirSync(agents_dir)
    .filter((f) => f.endsWith(".md") && !f.includes(".soul.") && !f.includes(".heart."))
    .sort();

  for (const file of files) {
    const role = basename(file, ".md");
    const persona = await load_role_persona(agents_dir, role);
    if (persona) map.set(role, persona);
  }

  return map;
}
