/**
 * docker-ops.ts — 미커버 분기 (cov2):
 * - L180: parse_label_string("") → if (!labels) return {}
 *   (list() 호출 시 Labels="" 인 컨테이너 JSON → 빈 Record 반환)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliDockerOps } from "@src/agent/pty/docker-ops.js";
import { execFile } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

const mock_exec = vi.mocked(execFile);

function stub_exec(stdout: string) {
  mock_exec.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, stdout, "");
    return {} as any;
  });
}

describe("CliDockerOps — L180: parse_label_string('') → {}", () => {
  let ops: CliDockerOps;

  beforeEach(() => {
    vi.clearAllMocks();
    ops = new CliDockerOps();
  });

  it("Labels='' 컨테이너 → L180 if (!labels) return {} 실행 → labels: {}", async () => {
    // raw.Labels="" → parse_label_string("") → L180: if (!labels) return {}
    const lines = JSON.stringify({ ID: "id1", Names: "agent-1", State: "running", Labels: "" });
    stub_exec(lines);

    const result = await ops.list({});
    expect(result).toHaveLength(1);
    expect(result[0]!.labels).toEqual({});
  });

  it("Labels 필드 없음 → ?? '' → parse_label_string('') → L180", async () => {
    // raw.Labels=undefined → ?? "" → parse_label_string("") → L180
    const lines = JSON.stringify({ ID: "id2", Names: "agent-2", State: "exited" }); // no Labels field
    stub_exec(lines);

    const result = await ops.list({});
    expect(result).toHaveLength(1);
    expect(result[0]!.labels).toEqual({});
  });
});
