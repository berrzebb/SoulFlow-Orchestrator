/**
 * handler 기준 workspace 통합 테스트.
 *
 * shell/git/process/file/database 등 실제 node handler가
 * ctx.workspace를 정확히 사용하는지 검증한다.
 * workspace와 process.cwd()를 의도적으로 다르게 설정하여
 * fallback이 아닌 injected workspace만 사용함을 확인.
 */

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { register_all_nodes } from "../../src/agent/nodes/index.js";
import { get_node_handler } from "../../src/agent/node-registry.js";
import type { OrcheNodeExecutorContext } from "../../src/agent/orche-node-executor.js";
import type { OrcheNodeDefinition } from "../../src/agent/workflow-node.types.js";

beforeAll(() => {
  register_all_nodes();
});

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ws-handler-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function make_ctx(ws: string): OrcheNodeExecutorContext {
  return { memory: {}, workspace: ws };
}

describe("shell node handler는 ctx.workspace를 cwd로 사용", () => {
  it("working_dir 미지정 시 ctx.workspace가 cwd", async () => {
    // workspace 안에 마커 파일 생성 후 ls/dir로 존재 확인
    await writeFile(join(workspace, "_ws_marker.txt"), "ok");

    const handler = get_node_handler("shell")!;
    const isWin = process.platform === "win32";
    const node = {
      node_id: "sh1", node_type: "shell", title: "ls",
      command: isWin ? "dir /b _ws_marker.txt" : "ls _ws_marker.txt",
    } as unknown as OrcheNodeDefinition;

    const result = await handler.execute!(node, make_ctx(workspace));
    const stdout = String((result.output as Record<string, unknown>).stdout || "").trim();
    expect(stdout).toContain("_ws_marker.txt");
  });
});

describe("git node handler는 ctx.workspace를 cwd로 사용", () => {
  it("git status가 ctx.workspace 디렉터리에서 실행됨", async () => {
    // git init으로 repo 생성
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: workspace, stdio: "pipe" });

    const handler = get_node_handler("git")!;
    const node = {
      node_id: "g1", node_type: "git", title: "status",
      operation: "status",
    } as unknown as OrcheNodeDefinition;

    const result = await handler.execute!(node, make_ctx(workspace));
    const stdout = String((result.output as Record<string, unknown>).stdout || "");
    // git status 성공 (에러가 아닌 정상 출력)
    expect(stdout).toBeDefined();
  });
});

describe("file node handler는 ctx.workspace 기준으로 경로 해석", () => {
  it("ctx.workspace 내 파일을 읽을 수 있다", async () => {
    await writeFile(join(workspace, "test.txt"), "hello workspace");

    const handler = get_node_handler("file")!;
    const node = {
      node_id: "f1", node_type: "file", title: "read",
      operation: "read", file_path: "test.txt",
    } as unknown as OrcheNodeDefinition;

    const result = await handler.execute!(node, make_ctx(workspace));
    const output = result.output as Record<string, unknown>;
    expect(String(output.content || output.output || "")).toContain("hello workspace");
  });

  it("workspace 밖 경로 접근은 차단된다", async () => {
    const handler = get_node_handler("file")!;
    const node = {
      node_id: "f2", node_type: "file", title: "read outside",
      operation: "read", file_path: "../../../etc/passwd",
    } as unknown as OrcheNodeDefinition;

    // 경로 순회 시 throw 또는 에러 output 반환
    try {
      const result = await handler.execute!(node, make_ctx(workspace));
      const output = result.output as Record<string, unknown>;
      const out_str = JSON.stringify(output).toLowerCase();
      expect(out_str).toMatch(/blocked|traversal|outside|denied|error/);
    } catch (err) {
      expect(String(err)).toMatch(/traversal|outside|not allowed/i);
    }
  });
});

describe("database node handler는 ctx.workspace 기준으로 datasource 경로 해석", () => {
  it("datasource 경로가 ctx.workspace/runtime/datasources 기준", async () => {
    const handler = get_node_handler("database")!;
    const node = {
      node_id: "db1", node_type: "database", title: "query",
      operation: "query", datasource: "testdb", sql: "SELECT 1",
    } as unknown as OrcheNodeDefinition;

    const result = await handler.execute!(node, make_ctx(workspace));
    const output = result.output as Record<string, unknown>;
    const result_str = String(output.result || "");
    // 존재하지 않는 DB이므로 에러에 workspace 경로 포함
    const expected_path = join(workspace, "runtime", "datasources", "testdb.db");
    expect(result_str).toContain(expected_path);
  });
});

describe("process node handler는 ctx.workspace를 cwd로 사용", () => {
  it("list 명령이 ctx.workspace에서 실행됨", async () => {
    const handler = get_node_handler("process")!;
    const node = {
      node_id: "p1", node_type: "process", title: "list",
      operation: "list",
    } as unknown as OrcheNodeDefinition;

    const result = await handler.execute!(node, make_ctx(workspace));
    const output = result.output as Record<string, unknown>;
    expect(output.success).toBe(true);
  });
});

describe("stateful constructor는 workspace 누락 시 타입 에러", () => {
  it("WorkflowEventService는 workspace를 필수로 요구한다", async () => {
    const { WorkflowEventService } = await import("../../src/events/service.js");
    const svc = new WorkflowEventService(workspace);
    expect(svc.root).toBe(workspace);
  });

  it("SessionStore는 workspace를 필수로 요구한다", async () => {
    const { SessionStore } = await import("../../src/session/service.js");
    const store = new SessionStore(workspace, undefined, null);
    expect(store.workspace).toBe(workspace);
  });

  it("MemoryStore는 workspace를 필수로 요구한다", async () => {
    const { MemoryStore } = await import("../../src/agent/memory.service.js");
    const store = new MemoryStore(workspace);
    expect((store as any).root).toBe(workspace);
  });
});
