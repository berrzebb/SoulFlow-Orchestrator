import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export class TemplateEngine {
  private readonly templates = new Map<string, string>();

  constructor(workspace = process.cwd()) {
    const templates_dir = join(workspace, "templates");
    if (!existsSync(templates_dir)) return;
    for (const name of readdirSync(templates_dir)) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const key = basename(name, ".md").toUpperCase();
      const full_path = join(templates_dir, name);
      const raw = readFileSync(full_path, "utf-8").trim();
      this.templates.set(key, raw);
    }
  }

  get(name: string): string {
    return this.templates.get(String(name || "").toUpperCase()) || "";
  }

  getBootstrapSet(): Record<string, string> {
    return Object.fromEntries(this.templates.entries());
  }

  render(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ""));
  }
}
