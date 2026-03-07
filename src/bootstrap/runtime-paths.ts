/** 런타임 경로 유틸 + 워크플로우 시드. import.meta.url 의존 함수는 main.ts에 남김. */

import { join, resolve } from "node:path";
import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";

export function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export function seed_default_workflows(workspace: string, app_root: string): void {
  const target_dir = join(workspace, "workflows");
  mkdirSync(target_dir, { recursive: true });

  const existing = readdirSync(target_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (existing.length > 0) return;

  const candidates = [
    join(app_root, "default-workflows"),
    join(app_root, "workspace", "workflows"),
  ];
  const source_dir = candidates.find((d) => existsSync(d));
  if (!source_dir) return;

  const templates = readdirSync(source_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of templates) {
    copyFileSync(join(source_dir, file), join(target_dir, file));
  }
}
