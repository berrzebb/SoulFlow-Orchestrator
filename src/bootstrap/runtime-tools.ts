/** Runtime tool registration: 에이전트 런타임에 도구 등록 + MCP 도구 로드. */

import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { KanbanTool } from "../agent/tools/kanban.js";
import type { DecisionService } from "../decision/index.js";
import type { OAuthIntegrationStore } from "../oauth/integration-store.js";
import type { OAuthFlowService } from "../oauth/flow-service.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { McpClientManager } from "../mcp/index.js";
import type { CronService } from "../cron/index.js";
import type { create_logger } from "../logger.js";
import { CronTool, MemoryTool, DecisionTool, SecretTool, PromiseTool, TaskQueryTool, WorkflowTool } from "../agent/tools/index.js";
import { OAuthFetchTool } from "../agent/tools/oauth-fetch.js";
import { FileMcpServerStore } from "../agent/tools/mcp-store.js";
import { create_mcp_tool_adapters } from "../mcp/index.js";

export interface RuntimeToolsDeps {
  workspace: string;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  providers: ProviderRegistry;
  cron: CronService;
  decisions: DecisionService;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  mcp: McpClientManager;
  kanban_tool: KanbanTool;
  workflow_ops_result: unknown;
  agent_provider_ops_result: unknown;
  logger: ReturnType<typeof create_logger>;
}

/** 에이전트 런타임에 내장 도구 등록 (중복 방지 포함). */
export function register_runtime_tools(deps: RuntimeToolsDeps): void {
  const {
    agent, agent_runtime, providers, cron, decisions,
    oauth_store, oauth_flow, kanban_tool,
    workflow_ops_result, agent_provider_ops_result,
  } = deps;

  if (!agent_runtime.has_tool("cron")) {
    agent_runtime.register_tool(new CronTool(cron));
  }
  if (!agent_runtime.has_tool("memory")) {
    agent_runtime.register_tool(new MemoryTool(agent.context.memory_store));
  }
  if (!agent_runtime.has_tool("decision")) {
    agent_runtime.register_tool(new DecisionTool(decisions));
  }
  if (!agent_runtime.has_tool("secret")) {
    agent_runtime.register_tool(new SecretTool(providers.get_secret_vault()));
  }
  if (!agent_runtime.has_tool("promise")) {
    agent_runtime.register_tool(new PromiseTool(agent.context.promise_service));
  }
  if (!agent_runtime.has_tool("task_query")) {
    agent_runtime.register_tool(new TaskQueryTool(async (task_id) => {
      const state = await agent_runtime.get_task(task_id);
      if (!state) return null;
      return {
        task_id: state.taskId,
        title: state.title,
        status: state.status,
        current_step: state.currentStep,
        exit_reason: state.exitReason,
        current_turn: state.currentTurn,
        max_turns: state.maxTurns,
      };
    }));
  }
  if (!agent_runtime.has_tool("oauth_fetch")) {
    agent_runtime.register_tool(new OAuthFetchTool(oauth_store, oauth_flow));
  }
  if (!agent_runtime.has_tool("workflow")) {
    agent_runtime.register_tool(new WorkflowTool(workflow_ops_result as never, agent_provider_ops_result as never));
  }
  if (!agent_runtime.has_tool("kanban")) {
    agent_runtime.register_tool(kanban_tool);
  }
}

/** MCP 서버 등록 + 도구 어댑터 생성. */
export async function register_mcp_tools(
  workspace: string,
  mcp: McpClientManager,
  agent_runtime: ReturnType<typeof create_agent_runtime>,
  logger: ReturnType<typeof create_logger>,
): Promise<void> {
  const mcp_store = new FileMcpServerStore(workspace);
  const servers = await mcp_store.list_servers();
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.command) {
      mcp.register_server(name, {
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        startup_timeout_ms: (entry.startup_timeout_sec ?? 15) * 1000,
      });
    }
  }
  await mcp.start();
  const adapters = create_mcp_tool_adapters(mcp);
  for (const adapter of adapters) {
    agent_runtime.register_tool(adapter);
  }
  if (adapters.length > 0) {
    logger.info(`mcp tools registered count=${adapters.length}`);
  }
}
