/**
 * Phase Loop CLI 테스트 러너.
 * 실제 프로바이더로 워크플로우 YAML을 실행하고 결과를 출력한다.
 *
 * 사용법:
 *   npx tsx scripts/test-phase-workflow.ts [yaml_path] [objective]
 *
 * 예시:
 *   npx tsx scripts/test-phase-workflow.ts workspace/workflows/simple-test.yaml "AI 시장 동향 분석"
 *   npx tsx scripts/test-phase-workflow.ts  # 기본: simple-test.yaml + 기본 objective
 */

import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── 프로젝트 루트 / workspace 해석 ──
const src_dir = fileURLToPath(new URL(".", import.meta.url));
const project_root = resolve(src_dir, "..");
const workspace = process.env.WORKSPACE || join(project_root, "workspace");

async function main() {
  const yaml_path = process.argv[2] || join(workspace, "workflows", "simple-test.yaml");
  const objective = process.argv[3] || "Analyze the current state of the AI agent market in 2025";

  log("phase-loop", `Loading workflow: ${yaml_path}`);

  // ── 1. YAML 로드 ──
  const { load_workflow_template, substitute_variables } = await import("../src/orchestration/workflow-loader.js");

  // 직접 파일 읽기 → YAML 파싱
  const raw_yaml = readFileSync(resolve(yaml_path), "utf-8");
  const yaml_mod_name = "js-yaml";
  let template: Record<string, unknown>;
  try {
    const yaml = await import(yaml_mod_name);
    template = yaml.default?.load?.(raw_yaml) ?? yaml.load(raw_yaml);
  } catch {
    template = JSON.parse(raw_yaml);
  }

  const definition = substitute_variables(
    template as import("../src/agent/phase-loop.types.js").WorkflowDefinition,
    { objective, channel: "cli" },
  );

  log("phase-loop", `Workflow: ${definition.title}`);
  log("phase-loop", `Objective: ${objective}`);
  log("phase-loop", `Phases: ${definition.phases.length}`);
  for (const [i, p] of definition.phases.entries()) {
    const critic_note = p.critic ? " + critic" : "";
    log("phase-loop", `  Phase ${i + 1}: ${p.title} (${p.agents.length} agents${critic_note})`);
  }
  console.log("");

  // ── 2. 최소 의존성 초기화 ──
  const { create_logger, init_log_level } = await import("../src/logger.js");
  init_log_level((process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info");
  const logger = create_logger("phase-loop-cli");

  const data_dir = join(workspace, "runtime");

  // SecretVault + ProviderStore → API 키 로드
  const { get_shared_secret_vault } = await import("../src/security/secret-vault-factory.js");
  const { AgentProviderStore } = await import("../src/agent/provider-store.js");
  const shared_vault = get_shared_secret_vault(workspace);

  // App config 로드 (main.ts와 동일 경로)
  const { load_config_merged } = await import("../src/config/schema.js");
  const { ConfigStore } = await import("../src/config/config-store.js");
  const config_store = new ConfigStore(join(workspace, "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);
  const provider_store = new AgentProviderStore(
    join(data_dir, "agent-providers", "providers.db"),
    shared_vault,
  );

  // ProviderRegistry (main.ts와 동일한 fallback 체인)
  const { ProviderRegistry } = await import("../src/providers/service.js");
  const openrouter_key = await provider_store.get_token("openrouter");
  const openrouter_config = provider_store.get("openrouter");
  const orchestrator_llm_key = await provider_store.get_token("orchestrator_llm");
  const orchestrator_llm_config = provider_store.get("orchestrator_llm");

  const providers = new ProviderRegistry({
    openrouter_api_key: openrouter_key,
    openrouter_api_base: (openrouter_config?.settings.api_base as string) || undefined,
    openrouter_model: (openrouter_config?.settings.model as string) || undefined,
    orchestrator_llm_api_key: orchestrator_llm_key,
    orchestrator_llm_api_base: (orchestrator_llm_config?.settings.api_base as string) || app_config.orchestratorLlm.apiBase,
    orchestrator_llm_model: (orchestrator_llm_config?.settings.model as string) || app_config.orchestratorLlm.model,
    orchestrator_provider: process.env.ORCHESTRATOR_PROVIDER || app_config.orchestration?.orchestratorProvider || undefined,
  });

  log("phase-loop", `Orchestrator provider: ${providers.get_orchestrator_provider_id()}`);

  // AgentBackendRegistry — ContainerCliAgent (PTY) 기반 백엔드 직접 생성
  const { AgentBackendRegistry } = await import("../src/agent/agent-registry.js");
  const { ContainerCliAgent } = await import("../src/agent/pty/container-cli-agent.js");
  const { ContainerPool } = await import("../src/agent/pty/container-pool.js");
  const { AgentBus } = await import("../src/agent/pty/agent-bus.js");
  const { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } = await import("../src/agent/pty/cli-adapter.js");
  const { local_pty_factory } = await import("../src/agent/pty/local-pty.js");

  // e2e 테스트와 동일 패턴: DB 무관하게 ContainerCliAgent 직접 생성
  const cli_configs: Array<{ id: string; adapter_fn: () => InstanceType<typeof ClaudeCliAdapter | typeof CodexCliAdapter | typeof GeminiCliAdapter> }> = [
    { id: "claude_cli", adapter_fn: () => new ClaudeCliAdapter() },
    { id: "codex_cli", adapter_fn: () => new CodexCliAdapter() },
    { id: "gemini_cli", adapter_fn: () => new GeminiCliAdapter() },
  ];

  const backends: import("../src/agent/agent.types.js").AgentBackend[] = [];
  const cleanup_handles: Array<{ stop: () => void }> = [];

  for (const cfg of cli_configs) {
    const adapter = cfg.adapter_fn();
    const pool = new ContainerPool({
      pty_factory: local_pty_factory,
      adapter,
      default_env: {},
      cwd: workspace,
      max_idle_ms: 0,
      logger: logger.child(`pty:${cfg.id}`),
    });
    const bus = new AgentBus({ pool, adapter, logger: logger.child(`bus:${cfg.id}`) });
    const agent = new ContainerCliAgent({
      id: cfg.id,
      bus,
      adapter,
      logger: logger.child(cfg.id),
      default_env: {},
    });
    backends.push(agent);
    cleanup_handles.push(agent);
    log("phase-loop", `Backend registered: ${cfg.id} (PTY/${adapter.cli_id})`);
  }

  const agent_backend_registry = new AgentBackendRegistry({
    provider_registry: providers,
    backends,
    config: { claude_backend: "claude_cli", codex_backend: "codex_cli", gemini_backend: "gemini_cli" },
    logger: logger.child("agent-registry"),
  });

  const provider_caps = {
    chatgpt_available: true,
    claude_available: true,
    openrouter_available: Boolean(openrouter_key),
  };

  // SubagentRegistry
  const { SubagentRegistry } = await import("../src/agent/subagents.js");
  const subagents = new SubagentRegistry({
    workspace,
    providers,
    agent_backends: agent_backend_registry,
    logger: logger.child("subagents"),
    provider_caps,
  });

  // PhaseWorkflowStore
  const { PhaseWorkflowStore } = await import("../src/agent/phase-workflow-store.js");
  const store_dir = join(data_dir, "workflows");
  mkdirSync(store_dir, { recursive: true });
  const store = new PhaseWorkflowStore(store_dir);

  // ── 3. run_phase_loop 실행 ──
  const { run_phase_loop } = await import("../src/agent/phase-loop-runner.js");
  const { short_id } = await import("../src/utils/common.js");

  const workflow_id = `wf-test-${short_id(8)}`;
  const start = Date.now();

  log("phase-loop", `Starting workflow: ${workflow_id}\n`);

  const result = await run_phase_loop(
    {
      workflow_id,
      title: definition.title,
      objective,
      channel: "cli",
      chat_id: "manual-test",
      phases: definition.phases,
      on_phase_change: (state) => {
        log("phase-loop", `Phase ${state.current_phase + 1}/${state.phases.length}: ${state.phases[state.current_phase]?.title} (${state.phases[state.current_phase]?.status})`);
      },
      on_agent_update: (phase_id, agent_id, agent_state) => {
        const usage = agent_state.usage ? ` (${agent_state.usage.input + agent_state.usage.output} tokens)` : "";
        log("phase-loop", `  ${status_icon(agent_state.status)} ${agent_state.label}: ${agent_state.status}${usage}`);
      },
    },
    {
      subagents,
      store,
      logger,
      on_event: (event) => {
        if (event.type === "critic_completed") {
          log("phase-loop", `  ${event.approved ? "\u2713" : "\u2717"} critic: ${event.approved ? "approved" : "rejected"} \u2014 ${event.review.slice(0, 120)}`);
        }
      },
    },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  if (result.status === "completed") {
    log("phase-loop", `Workflow completed in ${elapsed}s`);
  } else {
    log("phase-loop", `Workflow ${result.status}: ${result.error || ""} (${elapsed}s)`);
  }

  // ── 4. 결과 출력 ──
  console.log("\n--- Results ---\n");
  for (const phase of result.phases) {
    console.log(`Phase: ${phase.title} (${phase.status})`);
    for (const agent of phase.agents) {
      const icon = status_icon(agent.status);
      console.log(`  ${icon} ${agent.label}:`);
      if (agent.result) {
        console.log(`    ${agent.result.slice(0, 500)}`);
      }
      if (agent.error) {
        console.log(`    ERROR: ${agent.error}`);
      }
    }
    if (phase.critic?.review) {
      console.log(`  Critic: ${phase.critic.approved ? "Approved" : "Rejected"}`);
      console.log(`    ${phase.critic.review.slice(0, 300)}`);
    }
    console.log("");
  }

  // 결과 JSON 저장
  const results_dir = join(store_dir, "test-results");
  mkdirSync(results_dir, { recursive: true });
  const result_path = join(results_dir, `${workflow_id}.json`);
  writeFileSync(result_path, JSON.stringify(result, null, 2), "utf-8");
  log("phase-loop", `Results saved to: ${result_path}`);

  // PTY 프로세스 정리 후 종료
  for (const h of cleanup_handles) h.stop();
  process.exit(result.status === "completed" ? 0 : 1);
}

function log(prefix: string, msg: string): void {
  console.log(`[${prefix}] ${msg}`);
}

function status_icon(status: string): string {
  switch (status) {
    case "completed": return "o";
    case "failed": return "x";
    case "running": return "~";
    default: return "-";
  }
}

main().catch((err) => {
  console.error("[phase-loop] Fatal error:", err);
  process.exit(1);
});
