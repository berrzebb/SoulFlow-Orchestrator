import { randomUUID } from "node:crypto";
import { now_iso } from "../../utils/common.js";
import { parse_approval_response, type ApprovalDecision, type ApprovalParseResult } from "./approval-parser.js";
import type {
  BackgroundExecuteResult,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  ToolExecutionContext,
  ToolLike,
} from "./types.js";

const ERROR_HINT = "\n\n[Analyze the error and retry with a safer or narrower approach.]";

function as_error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function is_terminal(status: BackgroundTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

type ApprovalRequest = {
  request_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  context?: ToolExecutionContext;
  detail: string;
  created_at: string;
  status: "pending" | "approved" | "denied" | "deferred" | "cancelled" | "clarify";
  response_text?: string;
  response_parsed?: ApprovalParseResult;
};

type ToolRegistryOptions = {
  on_approval_request?: (request: ApprovalRequest) => Promise<void>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolLike>();
  private readonly dynamic_tool_names = new Set<string>();
  private readonly background_tasks = new Map<string, BackgroundTaskRecord>();
  private readonly task_aborters = new Map<string, AbortController>();
  private readonly approval_requests = new Map<string, ApprovalRequest>();
  private readonly on_approval_request: ((request: ApprovalRequest) => Promise<void>) | null;

  constructor(options?: ToolRegistryOptions) {
    this.on_approval_request = options?.on_approval_request || null;
  }

  register(tool: ToolLike): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.dynamic_tool_names.delete(name);
    this.tools.delete(name);
  }

  get(name: string): ToolLike | null {
    return this.tools.get(name) || null;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  tool_names(): string[] {
    return [...this.tools.keys()];
  }

  set_dynamic_tools(tools: ToolLike[]): void {
    for (const name of this.dynamic_tool_names.values()) {
      this.tools.delete(name);
    }
    this.dynamic_tool_names.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.dynamic_tool_names.add(tool.name);
    }
  }

  get_definitions(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((tool) => tool.to_schema() as Record<string, unknown>);
  }

  async execute(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Tool '${name}' not found. Available: ${this.tool_names().join(", ")}`;
    }
    try {
      const errors = tool.validate_params(params);
      if (errors.length > 0) {
        return `Error: Invalid parameters for tool '${name}': ${errors.join("; ")}${ERROR_HINT}`;
      }
      const result = await tool.execute(params, context);
      if (result.startsWith("Error: approval_required")) {
        const request = this.create_approval_request(name, params, context, result);
        await this.notify_approval_required(request);
        const response_hint = [
          "",
          `approval_request_id: ${request.request_id}`,
          "approval_reply_examples: ✅ / 👍 / yes / 승인 / 허용 / go | ❌ / 👎 / no / 거절 / 불가 / stop | ⏸️ / 보류 / later | ? / 이유",
        ].join("\n");
        return `${result}\n${response_hint}`;
      }
      if (result.startsWith("Error:")) return `${result}${ERROR_HINT}`;
      return result;
    } catch (error) {
      return `Error executing ${name}: ${as_error_message(error)}${ERROR_HINT}`;
    }
  }

  async execute_background(name: string, params: Record<string, unknown>): Promise<BackgroundExecuteResult> {
    const task_id = randomUUID().slice(0, 12);
    const record: BackgroundTaskRecord = {
      id: task_id,
      tool_name: name,
      params: { ...params },
      status: "queued",
      created_at: now_iso(),
    };
    this.background_tasks.set(task_id, record);
    queueMicrotask(() => {
      void this._run_background(task_id);
    });
    return { task_id, status: "queued" };
  }

  private async _run_background(task_id: string): Promise<void> {
    const current = this.background_tasks.get(task_id);
    if (!current) return;
    const tool = this.tools.get(current.tool_name);
    if (!tool) {
      this.background_tasks.set(task_id, {
        ...current,
        status: "failed",
        finished_at: now_iso(),
        error: `tool_not_found:${current.tool_name}`,
      });
      return;
    }

    const controller = new AbortController();
    this.task_aborters.set(task_id, controller);
    this.background_tasks.set(task_id, {
      ...current,
      status: "running",
      started_at: now_iso(),
    });

    try {
      const errors = tool.validate_params(current.params);
      if (errors.length > 0) {
        this.background_tasks.set(task_id, {
          ...this.background_tasks.get(task_id)!,
          status: "failed",
          finished_at: now_iso(),
          error: `invalid_params:${errors.join("; ")}`,
        });
        return;
      }

      const result = await tool.execute(current.params, { task_id, signal: controller.signal });
      if (result.startsWith("Error: approval_required")) {
        const request = this.create_approval_request(current.tool_name, current.params, { task_id }, result);
        await this.notify_approval_required(request);
      }
      const prev = this.background_tasks.get(task_id);
      if (!prev) return;
      if (prev.status === "cancelled") return;
      this.background_tasks.set(task_id, {
        ...prev,
        status: "completed",
        finished_at: now_iso(),
        result,
      });
    } catch (error) {
      const prev = this.background_tasks.get(task_id);
      if (!prev) return;
      if (prev.status === "cancelled") return;
      this.background_tasks.set(task_id, {
        ...prev,
        status: "failed",
        finished_at: now_iso(),
        error: as_error_message(error),
      });
    } finally {
      this.task_aborters.delete(task_id);
    }
  }

  get_background_task(task_id: string): BackgroundTaskRecord | null {
    return this.background_tasks.get(task_id) || null;
  }

  list_background_tasks(options?: {
    status?: BackgroundTaskStatus;
    tool_name?: string;
    limit?: number;
  }): BackgroundTaskRecord[] {
    const limit = Math.max(1, Number(options?.limit || 100));
    const records = [...this.background_tasks.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .filter((item) => (options?.status ? item.status === options.status : true))
      .filter((item) => (options?.tool_name ? item.tool_name === options.tool_name : true));
    return records.slice(0, limit);
  }

  cancel_background_task(task_id: string): boolean {
    const record = this.background_tasks.get(task_id);
    if (!record) return false;
    if (is_terminal(record.status)) return false;
    this.task_aborters.get(task_id)?.abort();
    this.task_aborters.delete(task_id);
    this.background_tasks.set(task_id, {
      ...record,
      status: "cancelled",
      finished_at: now_iso(),
    });
    return true;
  }

  clear_completed_background(limit = 500): number {
    const max = Math.max(1, Number(limit || 500));
    let deleted = 0;
    for (const [id, row] of this.background_tasks.entries()) {
      if (!is_terminal(row.status)) continue;
      this.background_tasks.delete(id);
      deleted += 1;
      if (deleted >= max) break;
    }
    return deleted;
  }

  private async notify_approval_required(request: ApprovalRequest): Promise<void> {
    if (!this.on_approval_request) return;
    try {
      await this.on_approval_request(request);
    } catch {
      // keep tool execution path stable
    }
  }

  private create_approval_request(
    tool_name: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext | undefined,
    detail: string,
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      request_id: randomUUID().slice(0, 12),
      tool_name,
      params: { ...params },
      context,
      detail,
      created_at: now_iso(),
      status: "pending",
    };
    this.approval_requests.set(request.request_id, request);
    return request;
  }

  get_approval_request(request_id: string): ApprovalRequest | null {
    return this.approval_requests.get(request_id) || null;
  }

  list_approval_requests(status?: ApprovalRequest["status"]): ApprovalRequest[] {
    const rows = [...this.approval_requests.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!status) return rows;
    return rows.filter((r) => r.status === status);
  }

  resolve_approval_request(request_id: string, response_text: string): {
    ok: boolean;
    decision: ApprovalDecision;
    status: ApprovalRequest["status"];
    confidence: number;
  } {
    const req = this.approval_requests.get(request_id);
    if (!req) return { ok: false, decision: "unknown", status: "pending", confidence: 0 };
    const parsed = parse_approval_response(response_text);
    let status: ApprovalRequest["status"] = "pending";
    if (parsed.decision === "approve") status = "approved";
    else if (parsed.decision === "deny") status = "denied";
    else if (parsed.decision === "defer") status = "deferred";
    else if (parsed.decision === "cancel") status = "cancelled";
    else if (parsed.decision === "clarify") status = "clarify";
    req.status = status;
    req.response_text = response_text;
    req.response_parsed = parsed;
    this.approval_requests.set(request_id, req);
    return {
      ok: status !== "pending",
      decision: parsed.decision,
      status,
      confidence: parsed.confidence,
    };
  }

  async execute_approved_request(request_id: string): Promise<{
    ok: boolean;
    status: ApprovalRequest["status"] | "unknown";
    tool_name?: string;
    result?: string;
    error?: string;
  }> {
    const req = this.approval_requests.get(request_id);
    if (!req) return { ok: false, status: "unknown", error: "approval_request_not_found" };
    if (req.status !== "approved") {
      return { ok: false, status: req.status, tool_name: req.tool_name, error: `approval_not_approved:${req.status}` };
    }
    const tool = this.tools.get(req.tool_name);
    if (!tool) return { ok: false, status: req.status, tool_name: req.tool_name, error: `tool_not_found:${req.tool_name}` };
    try {
      const params = { ...req.params, __approved: true };
      const result = await tool.execute(params, req.context);
      if (result.startsWith("Error: approval_required")) {
        return { ok: false, status: req.status, tool_name: req.tool_name, error: "still_requires_approval" };
      }
      if (result.startsWith("Error:")) {
        return { ok: false, status: req.status, tool_name: req.tool_name, error: result };
      }
      req.status = "approved";
      this.approval_requests.set(request_id, req);
      return { ok: true, status: req.status, tool_name: req.tool_name, result };
    } catch (error) {
      return {
        ok: false,
        status: req.status,
        tool_name: req.tool_name,
        error: as_error_message(error),
      };
    }
  }
}
