import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = "scripts/eval-run.ts";

function run(args: string, opts?: { cwd?: string; expectFail?: boolean }): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${SCRIPT} ${args}`, {
      cwd: opts?.cwd ?? process.cwd(),
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    if (!opts?.expectFail) throw e;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

function write_dataset(dir: string, name: string, cases: { id: string; input: string; expected?: string; tags?: string[] }[]) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ name, cases }), "utf-8");
}

describe("eval-run CLI", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "eval-cli-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("--help → usage 출력", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--baseline");
    expect(stdout).toContain("--scorer");
  });

  it("입력 미지정 → 에러 + usage", () => {
    const { stderr, stdout, exitCode } = run("", { expectFail: true });
    const output = stderr + stdout;
    expect(output).toContain("specify");
    expect(exitCode).not.toBe(0);
  });

  it("빈 디렉토리 → No datasets found", () => {
    const { stdout } = run(tmp);
    expect(stdout).toContain("No datasets found");
  });

  it("데이터셋 로드 + 실행 + 결과 출력", () => {
    write_dataset(tmp, "test-ds", [
      { id: "c1", input: "hello", expected: "echo" },
      { id: "c2", input: "world", expected: "missing" },
    ]);
    const { stdout } = run(tmp);
    expect(stdout).toContain("Running: test-ds (2 cases)");
    expect(stdout).toContain("Total: 2");
  });

  it("--output → report JSON 저장", () => {
    write_dataset(tmp, "out-ds", [{ id: "c1", input: "test", expected: "echo" }]);
    const reportPath = join(tmp, "report.json");
    const { stdout } = run(`${tmp} --output "${reportPath}"`);
    expect(stdout).toContain("Report saved:");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.dataset).toBe("out-ds");
    expect(report.total).toBe(1);
    expect(report.scorecards).toHaveLength(1);
  });

  it("--save-baseline + --baseline → baseline 저장", () => {
    write_dataset(tmp, "bl-ds", [{ id: "c1", input: "hello", expected: "echo" }]);
    const baselinePath = join(tmp, "baseline.json");
    const { stdout } = run(`${tmp} --baseline "${baselinePath}" --save-baseline`);
    expect(stdout).toContain("Baseline saved:");
    expect(existsSync(baselinePath)).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
    expect(baseline.dataset).toBe("bl-ds");
  });

  it("--baseline (diff 비교) → improved/regressed 출력", () => {
    const dsDir = join(tmp, "datasets");
    const blDir = join(tmp, "baselines");
    mkdirSync(dsDir);
    mkdirSync(blDir);
    write_dataset(dsDir, "diff-ds", [
      { id: "c1", input: "hello", expected: "echo" },
      { id: "c2", input: "fail", expected: "nomatch" },
    ]);

    const baselinePath = join(blDir, "baseline.json");
    // baseline 저장
    run(`${dsDir} --baseline "${baselinePath}" --save-baseline`);
    // baseline diff 비교
    const { stdout } = run(`${dsDir} --baseline "${baselinePath}"`);
    expect(stdout).toContain("Baseline diff:");
    expect(stdout).toContain("pass_rate_delta=");
  });

  it("--markdown → markdown summary 출력", () => {
    write_dataset(tmp, "md-ds", [{ id: "c1", input: "test", expected: "echo" }]);
    const { stdout } = run(`${tmp} --markdown`);
    expect(stdout).toContain("# Evaluation Report: md-ds");
    expect(stdout).toContain("**Total**:");
  });

  it("--scorer exact → 정확 일치 채점", () => {
    write_dataset(tmp, "exact-ds", [{ id: "c1", input: "hello", expected: "echo: hello" }]);
    const reportPath = join(tmp, "exact-report.json");
    run(`${tmp} --scorer exact --output "${reportPath}"`);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.scorecards[0].overall_passed).toBe(true);
  });

  it("--tags 필터 → 매칭 케이스만 실행", () => {
    write_dataset(tmp, "tag-ds", [
      { id: "c1", input: "hello", expected: "echo", tags: ["fast"] },
      { id: "c2", input: "world", expected: "echo", tags: ["slow"] },
    ]);
    const reportPath = join(tmp, "tag-report.json");
    run(`${tmp} --tags fast --output "${reportPath}"`);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.total).toBe(1);
    expect(report.scorecards[0].case_id).toBe("c1");
  });
});

describe("eval-run CLI — bundles", () => {
  it("--bundle routing → routing 번들 실행", () => {
    const { stdout } = run("--bundle routing");
    expect(stdout).toContain("Running: routing");
  });

  it("--bundle unknown → 에러", () => {
    const { stderr, stdout, exitCode } = run("--bundle nonexistent", { expectFail: true });
    const output = stderr + stdout;
    expect(output).toContain("unknown bundle");
    expect(exitCode).not.toBe(0);
  });

  it("--smoke → smoke 번들들만 실행", () => {
    const { stdout } = run("--smoke");
    expect(stdout).toContain("Smoke bundles:");
    expect(stdout).toContain("routing");
    expect(stdout).toContain("safety");
    expect(stdout).toContain("tokenizer");
    expect(stdout).toContain("gateway");
  });

  it("--full → 모든 번들 실행", () => {
    const { stdout } = run("--full");
    expect(stdout).toContain("Full run:");
    expect(stdout).toContain("routing");
    expect(stdout).toContain("compiler");
    expect(stdout).toContain("memory");
  });

  it("--threshold 100 + scorer exact → pass rate 미달 시 exit 1", () => {
    const { stdout, exitCode } = run("--bundle routing --threshold 100 --scorer exact", { expectFail: true });
    expect(stdout).toContain("Overall:");
    expect(stdout).toContain("threshold: 100%");
    expect(exitCode).not.toBe(0);
  });

  it("--threshold 0 → 항상 통과", () => {
    const { stdout } = run("--bundle routing --threshold 0");
    expect(stdout).toContain("Overall:");
    expect(stdout).toContain("threshold: 0%");
  });

  it("--bundle tokenizer --scorer exact --threshold 100 → 전체 통과", () => {
    const { stdout } = run("--bundle tokenizer --scorer exact --threshold 100");
    expect(stdout).toContain("Running: tokenizer");
    // bundle tags=["smoke"] → smoke 태그 케이스만 필터 (7/12)
    expect(stdout).toContain("Passed: 7");
    expect(stdout).toContain("Failed: 0");
  });

  it("--bundle guardrails --scorer exact --threshold 100 → 전체 통과", () => {
    const { stdout } = run("--bundle guardrails --scorer exact --threshold 100");
    expect(stdout).toContain("Running: guardrails");
    // bundle tags=["smoke"] → smoke 태그 케이스만 필터 (4/8)
    expect(stdout).toContain("Passed: 4");
    expect(stdout).toContain("Failed: 0");
  });

  it("--bundle gateway --scorer exact --threshold 100 → 전체 통과", () => {
    const { stdout } = run("--bundle gateway --scorer exact --threshold 100");
    expect(stdout).toContain("Running: gateway");
    // bundle tags=["smoke"] → smoke 태그 케이스만 필터 (11/14)
    expect(stdout).toContain("Passed: 11");
    expect(stdout).toContain("Failed: 0");
  });

  it("--help → bundle/smoke/full 옵션 표시", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("--bundle");
    expect(stdout).toContain("--smoke");
    expect(stdout).toContain("--full");
    expect(stdout).toContain("--threshold");
  });
});
