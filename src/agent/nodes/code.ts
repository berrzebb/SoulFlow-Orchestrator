/** Code 노드 핸들러 — JS(vm) / shell / 컨테이너 샌드박스(python, ruby, go, …). */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { CodeNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { is_container_language, run_code_in_container, get_engine } from "./container-code-runner.js";

export const code_handler: NodeHandler = {
  node_type: "code",
  icon: "</>",
  color: "#2ecc71",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Return value / stdout" },
    { name: "logs",   type: "array",   description: "Console output (JS only)" },
  ],
  input_schema: [
    { name: "input", type: "object", description: "Code input data" },
  ],
  create_default: () => ({ language: "javascript", code: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CodeNodeDefinition;
    const timeout_ms = Math.min(120_000, Math.max(100, n.timeout_ms || 10_000));

    // 1. JavaScript — vm 샌드박스 (인프로세스, 가장 빠름)
    if (n.language === "javascript") {
      return execute_javascript(n, ctx, timeout_ms);
    }

    // 2. Shell — just-bash / 시스템 셸
    if (n.language === "shell") {
      return execute_shell(n, ctx, timeout_ms);
    }

    // 3. 컨테이너 언어 (python, ruby, go, rust, bash, deno, bun)
    if (is_container_language(n.language)) {
      return execute_container(n, ctx, timeout_ms);
    }

    throw new Error(`unsupported language: ${n.language}`);
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CodeNodeDefinition;
    const warnings: string[] = [];
    if (!n.code.trim()) warnings.push("code is empty");
    if (n.language === "javascript") {
      try { new Function(n.code); } catch (e) { warnings.push(`syntax error: ${error_message(e)}`); }
    }
    if (is_container_language(n.language) && !get_engine()) {
      warnings.push("no container engine (podman/docker) detected — container languages will fail at runtime");
    }
    return { preview: { language: n.language, code_length: n.code.length }, warnings };
  },
};

/** JavaScript — Node.js vm 샌드박스. */
async function execute_javascript(
  n: CodeNodeDefinition, ctx: OrcheNodeExecutorContext, timeout_ms: number,
): Promise<OrcheNodeExecuteResult> {
  const logs: string[] = [];
  const sandbox = createContext({
    memory: ctx.memory, JSON, Math, Date, Array, Object, String, Number, Boolean,
    parseInt, parseFloat, isNaN, isFinite,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => logs.push(`WARN: ${args.map(String).join(" ")}`),
      error: (...args: unknown[]) => logs.push(`ERROR: ${args.map(String).join(" ")}`),
    },
  });
  try {
    const wrapped = `(async () => { ${n.code} })()`;
    const result = await runInNewContext(wrapped, sandbox, { timeout: timeout_ms });
    return { output: { result, logs } };
  } catch (e) {
    throw new Error(`js execution failed: ${error_message(e)}`);
  }
}

/** Shell — just-bash 또는 시스템 기본 셸. */
async function execute_shell(
  n: CodeNodeDefinition, ctx: OrcheNodeExecutorContext, timeout_ms: number,
): Promise<OrcheNodeExecuteResult> {
  const cwd = ctx.workspace || process.cwd();
  try {
    const result = await run_shell_command(n.code, {
      cwd, timeout_ms, max_buffer_bytes: 1024 * 256, signal: ctx.abort_signal,
    });
    return { output: { stdout: result.stdout, stderr: result.stderr } };
  } catch (e) {
    throw new Error(`shell execution failed: ${error_message(e)}`);
  }
}

/** 컨테이너 샌드박스 — podman/docker run. */
async function execute_container(
  n: CodeNodeDefinition, ctx: OrcheNodeExecutorContext, timeout_ms: number,
): Promise<OrcheNodeExecuteResult> {
  const result = await run_code_in_container({
    language: n.language,
    code: n.code,
    timeout_ms,
    custom_image: n.container_image,
    signal: ctx.abort_signal,
    workspace: ctx.workspace,
    network_access: n.network_access,
    keep_container: n.keep_container,
  });

  if (result.exit_code !== 0) {
    throw new Error(`${n.language} execution failed (exit ${result.exit_code}): ${result.stderr || result.stdout}`);
  }

  return { output: { stdout: result.stdout, stderr: result.stderr } };
}
