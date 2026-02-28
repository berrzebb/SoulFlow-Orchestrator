import type { MessageBus, OutboundMessage } from "../../bus/index.js";
import type { CronScheduler } from "../../cron/contracts.js";
import { now_iso } from "../../utils/common.js";
import { CronTool } from "./cron.js";
import { EditFileTool, ListDirTool, ReadFileTool, WriteFileTool } from "./filesystem.js";
import { FileRequestTool } from "./file-request.js";
import { MessageTool } from "./message.js";
import { SpawnTool, type SpawnRequest } from "./spawn.js";
import { ToolRegistry } from "./registry.js";
import { ExecTool } from "./shell.js";
import { WebBrowserTool, WebFetchTool, WebSearchTool } from "./web.js";
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
import type { AppendWorkflowEventInput, AppendWorkflowEventResult } from "../../events/types.js";

export {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
  ExecTool,
  WebSearchTool,
  WebFetchTool,
  WebBrowserTool,
  DiagramRenderTool,
  MessageTool,
  FileRequestTool,
  SpawnTool,
  ChainTool,
  CronTool,
  MemoryTool,
  DecisionTool,
  SecretTool,
  PromiseTool,
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
  ToolExecuteResult,
  ToolExecutionContext,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  BackgroundExecuteResult,
} from "./types.js";
export type { DynamicToolManifestEntry } from "./dynamic.js";
export type { InstallShellToolInput } from "./installer.js";
export type { DynamicToolStoreLike } from "./store.js";
export type { McpServerStoreLike, McpServerEntry } from "./mcp-store.js";
export { execute_chain, type ChainStep, type ChainResult } from "./chain.js";

export function create_default_tool_registry(args?: {
  workspace?: string;
  allowed_dir?: string | null;
  dynamic_manifest_path?: string;
  dynamic_store_path?: string;
  dynamic_store?: DynamicToolStoreLike;
  cron?: CronScheduler | null;
  bus?: MessageBus | null;
  spawn_callback?: ((request: SpawnRequest) => Promise<{ subagent_id: string; status: string; message?: string }>) | null;
  event_recorder?: ((event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>) | null;
  refresh_skills?: () => void;
}): ToolRegistry {
  const registry = new ToolRegistry({
    on_approval_request: args?.bus
      ? async (request) => {
          const channel = String(request.context?.channel || "");
          const chat_id = String(request.context?.chat_id || "");
          if (!channel || !chat_id) return;
          const message: OutboundMessage = {
            id: `approval-${request.request_id}`,
            provider: channel,
            channel,
            sender_id: "approval-bot",
            chat_id,
            at: now_iso(),
            content: [
              "🔐 Approval Required",
              `request_id: ${request.request_id}`,
              `tool: ${request.tool_name}`,
              `reason: ${request.detail.split("\n")[0] || "restricted operation"}`,
              "",
              "Respond with:",
              "✅ / 👍 / yes / 승인 / 허용 / go",
              "❌ / 👎 / no / 거절 / 불가 / stop",
              "⏸️ / 보류 / later",
              "? / 이유 / explain",
            ].join("\n"),
            metadata: {
              kind: "approval_request",
              orchestrator_event: {
                event_id: request.request_id,
                run_id: String(request.context?.task_id || `run-${Date.now()}`),
                task_id: String(request.context?.task_id || "task-unspecified"),
                agent_id: String(request.context?.sender_id || "agent"),
                phase: "approval",
                summary: `${request.tool_name} approval required`,
                payload: { tool: request.tool_name, params: request.params },
                provider: channel,
                channel,
                chat_id,
                source: "outbound",
                at: now_iso(),
              },
              request_id: request.request_id,
              tool_name: request.tool_name,
              params: request.params,
              created_at: request.created_at,
            },
          };
          if (args?.event_recorder) {
            try {
              await args.event_recorder({
                event_id: request.request_id,
                run_id: String(request.context?.task_id || `run-${Date.now()}`),
                task_id: String(request.context?.task_id || "task-unspecified"),
                agent_id: String(request.context?.sender_id || "agent"),
                phase: "approval",
                summary: `${request.tool_name} approval required`,
                payload: { tool: request.tool_name, params: request.params },
                provider: channel,
                channel,
                chat_id,
                source: "outbound",
                at: now_iso(),
                detail: request.detail,
              });
            } catch {
              // keep approval flow non-blocking even if event storage fails
            }
          }
          await args.bus?.publish_outbound(message);
        }
      : undefined,
  });
  const workspace = args?.workspace || process.cwd();
  const allowed_dir = args?.allowed_dir ?? workspace;
  let sender: ((message: OutboundMessage) => Promise<void>) | null = null;

  registry.register(new ReadFileTool({ workspace, allowed_dir }));
  registry.register(new WriteFileTool({ workspace, allowed_dir }));
  registry.register(new EditFileTool({ workspace, allowed_dir }));
  registry.register(new ListDirTool({ workspace, allowed_dir }));
  registry.register(new ExecTool({ working_dir: workspace, restrict_to_working_dir: true }));
  registry.register(new WebSearchTool());
  registry.register(new WebFetchTool());
  registry.register(new WebBrowserTool());
  registry.register(new DiagramRenderTool());
  registry.register(new ChainTool(registry));

  if (args?.bus) {
    sender = async (message: OutboundMessage): Promise<void> => {
      await args.bus?.publish_outbound(message);
    };
    registry.register(new MessageTool({
      send_callback: sender,
      event_recorder: args?.event_recorder || null,
      workspace,
    }));
    registry.register(new FileRequestTool({ send_callback: sender }));
  }
  if (args?.spawn_callback) {
    registry.register(new SpawnTool(args.spawn_callback));
  }
  if (args?.cron) {
    registry.register(new CronTool(args.cron));
  }

  const dynamic_store_path = args?.dynamic_store_path || args?.dynamic_manifest_path;
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

  return registry;
}
