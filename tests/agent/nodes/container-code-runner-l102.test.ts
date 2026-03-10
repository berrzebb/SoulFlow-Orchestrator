/**
 * ContainerCodeRunner — L102 미커버 분기 보충.
 * L102: 지원하지 않는 언어 → "unsupported container language: ..." throw
 *
 * spawnSync를 mock해서 컨테이너 엔진 감지를 성공시킨 후
 * 지원하지 않는 언어로 run_code_in_container 호출 → L102 throw 확인.
 */
import { describe, it, expect, vi } from "vitest";

// ── node:child_process mock ────────────────────────────
// spawnSync: status=0 반환 → podman 감지 성공
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn().mockReturnValue({ status: 0 }),
    execFile: actual.execFile,
  };
});

import { run_code_in_container } from "@src/agent/nodes/container-code-runner.js";

describe("run_code_in_container — 지원하지 않는 언어 (L102)", () => {
  it("fortran 언어 → L102 throw 'unsupported container language'", async () => {
    await expect(
      run_code_in_container({
        language: "fortran" as any,
        code: "PRINT *, 'hello'",
        timeout_ms: 1000,
      }),
    ).rejects.toThrow("unsupported container language");
  });
});
