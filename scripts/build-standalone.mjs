/**
 * standalone/ 배포 디렉토리를 생성하는 빌드 스크립트.
 *
 * 멀티 플랫폼 지원 — 빌드 머신의 OS에 맞는 런타임과 런처를 생성한다.
 *
 * 구조:
 *   standalone/
 *   ├── node[.exe]        # Node.js 런타임 (빌드 머신에서 복사)
 *   ├── start.sh / start.bat  # 플랫폼별 런처
 *   ├── package.json      # 모듈 해석용
 *   ├── dist/             # 컴파일된 JS + web 프론트엔드
 *   ├── src/skills/       # 내장 스킬 (.md, .sh)
 *   └── node_modules/     # 프로덕션 의존성
 */
import { execSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "standalone");
const IS_WIN = process.platform === "win32";
const SKILL_EXTS = new Set([".md", ".sh"]);

function log(msg) {
  console.log(`  -> ${msg}`);
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function dir_stats(dir) {
  let files = 0;
  let bytes = 0;
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files++;
        bytes += statSync(full).size;
      }
    }
  }
  walk(dir);
  return { files, bytes };
}

function format_bytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** .md, .sh 파일만 재귀 복사 (디렉토리 구조 유지) */
function copy_skill_files(src, dest) {
  let count = 0;
  function walk(dir, rel) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src_path = join(dir, entry.name);
      const dest_path = join(dest, rel, entry.name);
      if (entry.isDirectory()) {
        walk(src_path, join(rel, entry.name));
      } else if (SKILL_EXTS.has(extname(entry.name).toLowerCase())) {
        mkdirSync(join(dest, rel), { recursive: true });
        cpSync(src_path, dest_path);
        count++;
      }
    }
  }
  walk(src, "");
  return count;
}

// ── 1. Clean ─────────────────────────────────────────────────────────────────
console.log(`\nStandalone build (${process.platform}/${process.arch})\n`);

if (existsSync(OUT)) {
  log("cleaning previous standalone/");
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

// ── 2. Backend build ─────────────────────────────────────────────────────────
run("npm run build", { cwd: ROOT });

// ── 3. Frontend build ────────────────────────────────────────────────────────
const web_dir = join(ROOT, "web");
if (existsSync(web_dir)) {
  run("npx vite build", { cwd: web_dir });
} else {
  log("web/ not found — skipping frontend build");
}

// ── 4. Node runtime ──────────────────────────────────────────────────────────
const node_bin = basename(process.execPath);
const node_dest = join(OUT, node_bin);
log(`copying ${process.execPath} -> ${node_dest}`);
cpSync(process.execPath, node_dest);

// ── 5. dist/ ─────────────────────────────────────────────────────────────────
log("copying dist/ -> standalone/dist/");
cpSync(join(ROOT, "dist"), join(OUT, "dist"), { recursive: true });

// ── 6. Skills (.md, .sh only) ────────────────────────────────────────────────
const skills_src = join(ROOT, "src", "skills");
if (existsSync(skills_src)) {
  const count = copy_skill_files(skills_src, join(OUT, "src", "skills"));
  log(`copied ${count} skill files -> standalone/src/skills/`);
} else {
  log("src/skills/ not found — skipping");
}

// ── 7. Production dependencies ───────────────────────────────────────────────
const root_pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const standalone_pkg = {
  name: root_pkg.name,
  version: root_pkg.version,
  private: true,
  type: "module",
  dependencies: root_pkg.dependencies ?? {},
  optionalDependencies: root_pkg.optionalDependencies ?? {},
};
writeFileSync(join(OUT, "package.json"), JSON.stringify(standalone_pkg, null, 2) + "\n");
log("generated standalone/package.json");

run("npm install --omit=dev", { cwd: OUT });

// ── 8. Launchers (both always generated) ─────────────────────────────────────
writeFileSync(
  join(OUT, "start.bat"),
  '@echo off\r\n"%~dp0node.exe" "%~dp0dist\\main.js" %*\r\n',
);
log("generated start.bat");

const sh_path = join(OUT, "start.sh");
writeFileSync(
  sh_path,
  '#!/usr/bin/env sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexec "$DIR/node" "$DIR/dist/main.js" "$@"\n',
);
if (!IS_WIN) chmodSync(sh_path, 0o755);
log("generated start.sh");

// ── 9. Summary ───────────────────────────────────────────────────────────────
const stats = dir_stats(OUT);
console.log(`\nstandalone/ ready — ${stats.files} files, ${format_bytes(stats.bytes)}\n`);
