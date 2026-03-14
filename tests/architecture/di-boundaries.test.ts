/**
 * DI Boundary regression test — concrete service import가 허용된 팩토리/bootstrap 밖으로
 * 누출되지 않았는지 정적으로 검증.
 *
 * PA-1 scope: SecretVaultService, OrchestrationService
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(__dirname, "..", "..", "src");

/** src/ 하위 모든 .ts 파일 경로 수집 (재귀). */
function collect_ts_files(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...collect_ts_files(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      result.push(full);
    }
  }
  return result;
}

/**
 * 주어진 정규식에 매칭되는 non-type import를 가진 파일 목록 반환.
 * `import type { X }` 형태는 제외 — 런타임 의존성이 아님.
 */
function find_concrete_imports(files: string[], pattern: RegExp): string[] {
  const violators: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const line of content.split("\n")) {
      // import type은 제외
      if (/^\s*import\s+type\b/.test(line)) continue;
      if (pattern.test(line)) {
        violators.push(relative(SRC, file).replaceAll(sep, "/"));
        break;
      }
    }
  }
  return violators;
}

describe("DI boundary — concrete service import confinement", () => {
  const all_files = collect_ts_files(SRC);

  it("SecretVaultService concrete import는 정의 파일 + 팩토리에만 존재", () => {
    const allowed = new Set([
      "security/secret-vault.ts",        // 클래스 정의
      "security/secret-vault-factory.ts", // 팩토리 (new SecretVaultService)
    ]);

    const violators = find_concrete_imports(
      all_files,
      /import\s*\{[^}]*\bSecretVaultService\b/,
    ).filter((f) => !allowed.has(f));

    expect(violators, `SecretVaultService concrete import 누출: ${violators.join(", ")}`).toEqual([]);
  });

  it("OrchestrationService concrete import는 정의 파일 + bootstrap에만 존재", () => {
    const allowed = new Set([
      "orchestration/service.ts",       // 클래스 정의
      "bootstrap/orchestration.ts",     // composition root (new OrchestrationService)
    ]);

    const violators = find_concrete_imports(
      all_files,
      /import\s*\{[^}]*\bOrchestrationService\b/,
    ).filter((f) => !allowed.has(f));

    expect(violators, `OrchestrationService concrete import 누출: ${violators.join(", ")}`).toEqual([]);
  });
});
