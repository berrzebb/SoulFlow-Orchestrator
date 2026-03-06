import type { MessageBusLike, OutboundMessage } from "../../bus/index.js";
import type { CronScheduler } from "../../cron/contracts.js";
import { CronTool } from "./cron.js";
import { EditFileTool, ListDirTool, ReadFileTool, SearchFilesTool, WriteFileTool } from "./filesystem.js";
import { AskUserTool } from "./ask-user.js";
import { FileRequestTool } from "./file-request.js";
import { MessageTool } from "./message.js";
import { SendFileTool } from "./send-file.js";
import { SpawnTool, type SpawnRequest } from "./spawn.js";
import { ToolRegistry } from "./registry.js";
import { ExecTool } from "./shell.js";
import { WebBrowserTool, WebExtractTool, WebFetchTool, WebMonitorTool, WebPdfTool, WebSearchTool, WebSnapshotTool } from "./web.js";
import { ChainTool } from "./chain.js";
import { DiagramRenderTool } from "./diagram.js";
import { DynamicToolRuntimeLoader, ToolRuntimeReloader } from "./runtime-loader.js";
import { ToolInstallerService } from "./installer.js";
import { SqliteDynamicToolStore, type DynamicToolStoreLike } from "./store.js";
import { FileMcpServerStore } from "./mcp-store.js";
import { ToolSelfTestService } from "./self-test.js";
import { MemoryTool } from "./memory-tool.js";
import { DecisionTool } from "./decision-tool.js";
import { SecretTool } from "./secret-tool.js";
import { PromiseTool } from "./promise-tool.js";
import { RuntimeAdminTool } from "./runtime-admin.js";
import { DateTimeTool } from "./datetime.js";
import { HttpRequestTool } from "./http-request.js";
import { OAuthFetchTool } from "./oauth-fetch.js";
import { TaskQueryTool, type TaskQueryCallback } from "./task-query.js";
import { WorkflowTool } from "./workflow.js";
import type { AppendWorkflowEventInput, AppendWorkflowEventResult } from "../../events/types.js";
import type { RuntimeExecutionPolicy } from "../../providers/types.js";
import type { PreToolHook, PostToolHook } from "./types.js";
import { build_approval_notifier } from "./approval-notifier.js";

const DANGEROUS_COMMANDS = ["rm -rf", "drop table", "format c:", "mkfs", "dd if="];

/** RuntimeExecutionPolicy.sandbox 기반 PreToolHook. 도구의 policy_flags 메타데이터로 write/network 판정. */
export function create_policy_pre_hook(policy: RuntimeExecutionPolicy, registry?: ToolRegistry | null): PreToolHook {
  return (tool_name, params) => {
    const sandbox = policy.sandbox;
    if (!sandbox || sandbox.approval === "auto-approve") return { permission: "allow" };

    const tool = registry?.get(tool_name) ?? null;
    const flags = tool?.policy_flags;
    const is_write = !!flags?.write;
    const is_network = !!flags?.network;

    if (!sandbox.network_access && is_network) {
      return { permission: "deny", reason: `network access disabled: ${tool_name} blocked` };
    }

    if (sandbox.fs_access === "read-only" && is_write) {
      return { permission: "ask", reason: `read-only policy: ${tool_name} requires approval` };
    }

    if (sandbox.fs_access === "workspace-write" && tool_name === "exec") {
      const cmd = String(params.command || "").toLowerCase();
      if (DANGEROUS_COMMANDS.some((d) => cmd.includes(d))) {
        return { permission: "deny", reason: `dangerous command blocked: ${cmd.slice(0, 50)}` };
      }
    }

    if (sandbox.approval === "always-ask" && is_write) {
      return { permission: "ask", reason: `approval required: ${tool_name}` };
    }

    if (sandbox.approval === "trusted-only" && is_write) {
      const cmd = String(params.command || "").toLowerCase();
      const is_dangerous = tool_name === "exec" && DANGEROUS_COMMANDS.some((d) => cmd.includes(d));
      if (is_dangerous) {
        return { permission: "deny", reason: `dangerous command blocked: ${cmd.slice(0, 50)}` };
      }
      return { permission: "ask", reason: `trusted-only: ${tool_name} requires approval` };
    }

    return { permission: "allow" };
  };
}

export {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
  SearchFilesTool,
  ExecTool,
  WebSearchTool,
  WebFetchTool,
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
  DiagramRenderTool,
  AskUserTool,
  MessageTool,
  FileRequestTool,
  SendFileTool,
  SpawnTool,
  ChainTool,
  CronTool,
  MemoryTool,
  DecisionTool,
  SecretTool,
  PromiseTool,
  DateTimeTool,
  HttpRequestTool,
  OAuthFetchTool,
  TaskQueryTool,
  WorkflowTool,
  DynamicToolRuntimeLoader,
  ToolRuntimeReloader,
  ToolInstallerService,
  SqliteDynamicToolStore,
  FileMcpServerStore,
  ToolSelfTestService,
  RuntimeAdminTool,
};
export { Tool } from "./base.js";
export type {
  JsonSchema,
  ToolSchema,
  ToolLike,
  ToolCategory,
  ToolPolicyFlags,
  ToolExecuteResult,
  ToolExecutionContext,
  ToolHookDecision,
  PreToolHook,
  PostToolHook,
} from "./types.js";
export type { DynamicToolManifestEntry } from "./dynamic.js";
export type { InstallShellToolInput } from "./installer.js";
export type { DynamicToolStoreLike } from "./store.js";
export type { McpServerStoreLike, McpServerEntry } from "./mcp-store.js";
export type { TaskQueryResult, TaskQueryCallback } from "./task-query.js";
export { execute_chain, type ChainStep, type ChainResult } from "./chain.js";
export { PolicyTool, type PolicyStoreLike } from "./policy-tool.js";
export { validate_url, normalize_headers, serialize_body, format_response, timed_fetch, type HttpResponseSummary } from "./http-utils.js";

/** create_default_tool_registry 옵션. */
export type ToolRegistryFactoryOptions = {
  workspace?: string;
  allowed_dir?: string | null;
  dynamic_store_path?: string;
  dynamic_store?: DynamicToolStoreLike;
  cron?: CronScheduler | null;
  bus?: MessageBusLike | null;
  spawn_callback?: ((request: SpawnRequest) => Promise<{ subagent_id: string; status: string; message?: string }>) | null;
  task_query_callback?: TaskQueryCallback | null;
  event_recorder?: ((event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>) | null;
  refresh_skills?: () => void;
  runtime_policy?: RuntimeExecutionPolicy;
  pre_hooks?: PreToolHook[];
  post_hooks?: PostToolHook[];
};

/** 팩토리 반환 번들 — 호출자가 내부 서비스를 재사용할 수 있도록 노출. */
export type ToolRegistryBundle = {
  registry: ToolRegistry;
  installer: ToolInstallerService;
  dynamic_loader: DynamicToolRuntimeLoader;
};

export function create_default_tool_registry(args?: ToolRegistryFactoryOptions): ToolRegistryBundle {
  const pre_hooks: PreToolHook[] = [...(args?.pre_hooks || [])];
  const registry = new ToolRegistry({
    pre_hooks,
    post_hooks: args?.post_hooks || [],
    on_approval_request: args?.bus
      ? build_approval_notifier({ bus: args.bus, event_recorder: args.event_recorder })
      : undefined,
  });
  if (args?.runtime_policy) {
    pre_hooks.unshift(create_policy_pre_hook(args.runtime_policy, registry));
  }
  const workspace = args?.workspace || process.cwd();
  const allowed_dir = args?.allowed_dir ?? workspace;
  let sender: ((message: OutboundMessage) => Promise<void>) | null = null;

  registry.register(new ReadFileTool({ workspace, allowed_dir }));
  registry.register(new WriteFileTool({ workspace, allowed_dir }));
  registry.register(new EditFileTool({ workspace, allowed_dir }));
  registry.register(new ListDirTool({ workspace, allowed_dir }));
  registry.register(new SearchFilesTool({ workspace, allowed_dir }));
  registry.register(new ExecTool({ working_dir: workspace, restrict_to_working_dir: true }));
  registry.register(new WebSearchTool());
  registry.register(new WebFetchTool());
  registry.register(new WebBrowserTool());
  registry.register(new WebSnapshotTool({ workspace }));
  registry.register(new WebExtractTool());
  registry.register(new WebPdfTool({ workspace }));
  registry.register(new WebMonitorTool({ workspace }));
  registry.register(new DiagramRenderTool());
  registry.register(new DateTimeTool());
  registry.register(new HttpRequestTool());
  registry.register(new ChainTool(registry));

  if (args?.task_query_callback) {
    registry.register(new TaskQueryTool(args.task_query_callback));
  }
  if (args?.bus) {
    sender = async (message: OutboundMessage): Promise<void> => {
      await args.bus?.publish_outbound(message);
    };
    registry.register(new MessageTool({
      send_callback: sender,
      event_recorder: args?.event_recorder || null,
      workspace,
    }));
    registry.register(new AskUserTool({ send_callback: sender }));
    registry.register(new FileRequestTool({ send_callback: sender }));
    registry.register(new SendFileTool({ send_callback: sender, workspace }));
  }
  if (args?.spawn_callback) {
    registry.register(new SpawnTool(args.spawn_callback));
  }
  if (args?.cron) {
    registry.register(new CronTool(args.cron));
  }

  const dynamic_store_path = args?.dynamic_store_path;
  const dynamic_store = args?.dynamic_store || new SqliteDynamicToolStore(workspace, dynamic_store_path);
  const dynamic_loader = new DynamicToolRuntimeLoader(workspace, dynamic_store_path, dynamic_store);
  registry.set_dynamic_tools(dynamic_loader.load_tools());
  const installer = new ToolInstallerService(workspace, dynamic_store_path, dynamic_store);
  registry.register(new RuntimeAdminTool({
    workspace,
    installer,
    list_registered_tool_names: () => registry.tool_names(),
    refresh_skills: args?.refresh_skills || undefined,
    refresh_dynamic_tools: () => {
      const tools = dynamic_loader.load_tools();
      registry.set_dynamic_tools(tools);
      return tools.length;
    },
  }));

  return { registry, installer, dynamic_loader };
}
