import { now_iso, error_message, short_id} from "../../utils/common.js";
import { parse_approval_response, type ApprovalDecision, type ApprovalParseResult } from "./approval-parser.js";
import type {
  PreToolHook,
  PostToolHook,
  ToolExecutionContext,
  ToolLike,
} from "./types.js";
import type { AgentApprovalStatus } from "../runtime.types.js";
import type { ParamSecretResolver } from "./base.js";

const ERROR_HINT = "\n\n[Analyze the error and retry with a safer or narrower approach.]";


type ApprovalRequest = {
  request_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  context?: ToolExecutionContext;
  detail: string;
  created_at: string;
  status: AgentApprovalStatus;
  response_text?: string;
  response_parsed?: ApprovalParseResult;
  /** true면 SDK 브리지 모드 — SDK가 도구 실행을 직접 관리하므로 execute_approved_request를 스킵. */
  bridge?: boolean;
};

type ToolRegistryOptions = {
  on_approval_request?: (request: ApprovalRequest) => Promise<void>;
  pre_hooks?: PreToolHook[];
  post_hooks?: PostToolHook[];
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolLike>();
  private readonly dynamic_tool_names = new Set<string>();
  private readonly approval_requests = new Map<string, ApprovalRequest>();
  private readonly approval_callbacks = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly on_approval_request: ((request: ApprovalRequest) => Promise<void>) | null;
  private readonly pre_hooks: PreToolHook[];
  private readonly post_hooks: PostToolHook[];
  /** "모두 승인" 시 세션 동안 자동 승인되는 도구 이름 집합. */
  private readonly auto_approved_tools = new Set<string>();

  constructor(options?: ToolRegistryOptions) {
    this.on_approval_request = options?.on_approval_request || null;
    this.pre_hooks = options?.pre_hooks || [];
    this.post_hooks = options?.post_hooks || [];
  }

  private _secret_resolver: ParamSecretResolver | null = null;

  register(tool: ToolLike): void {
    this.tools.set(tool.name, tool);
    if (this._secret_resolver) this.inject_resolver(tool);
  }

  /** 등록된 모든 도구에 파라미터 시크릿 해석기를 주입. */
  set_secret_resolver(resolver: ParamSecretResolver): void {
    this._secret_resolver = resolver;
    for (const tool of this.tools.values()) this.inject_resolver(tool);
  }

  private inject_resolver(tool: ToolLike): void {
    if (this._secret_resolver && "set_secret_resolver" in tool && typeof (tool as Record<string, unknown>).set_secret_resolver === "function") {
      (tool as { set_secret_resolver(r: ParamSecretResolver): void }).set_secret_resolver(this._secret_resolver);
    }
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

  /** 등록된 모든 ToolLike 인스턴스. */
  get_all(): ToolLike[] {
    return [...this.tools.values()];
  }

  set_dynamic_tools(tools: ToolLike[]): void {
    for (const name of this.dynamic_tool_names.values()) {
      this.tools.delete(name);
    }
    this.dynamic_tool_names.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.dynamic_tool_names.add(tool.name);
      if (this._secret_resolver) this.inject_resolver(tool);
    }
  }

  get_definitions(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((tool) => tool.to_schema() as Record<string, unknown>);
  }

  /** allowed_tools 기반 필터링된 래퍼. definitions와 execute 모두 allowlist를 적용. */
  filtered(allowed: string[]): Pick<ToolRegistry, "get_definitions" | "execute" | "tool_names"> {
    const allow_set = new Set(allowed);
    return {
      get_definitions: () => this.get_definitions().filter((d) => allow_set.has(String((d as Record<string, unknown>).name ?? ""))),
      execute: (name, params, ctx) => {
        if (!allow_set.has(name)) return Promise.resolve(`Error: Tool '${name}' is not allowed. Allowed: ${allowed.join(", ")}`);
        return this.execute(name, params, ctx);
      },
      tool_names: () => this.tool_names().filter((n) => allow_set.has(n)),
    };
  }

  /** 등록된 도구에서 name → category 매핑을 빌드. */
  build_category_map(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const tool of this.tools.values()) {
      map[tool.name] = tool.category;
    }
    return map;
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

      // PreToolUse hooks — deny가 하나라도 있으면 즉시 차단
      let effective_params = params;
      for (const hook of this.pre_hooks) {
        const decision = await hook(name, effective_params, context);
        if (decision.permission === "deny") {
          return `Error: denied by policy — ${decision.reason || "blocked"}${ERROR_HINT}`;
        }
        if (decision.permission === "ask" && !this.auto_approved_tools.has(name)) {
          return this.trigger_approval_from_hook(name, effective_params, context, decision.reason || "hook_requires_approval");
        }
        if (decision.updated_params) {
          effective_params = { ...effective_params, ...decision.updated_params };
        }
      }

      const result = await tool.execute(effective_params, context);
      const is_error = result.startsWith("Error:");

      // PostToolUse hooks — fire-and-forget
      for (const hook of this.post_hooks) {
        try { await hook(name, effective_params, result, context, is_error); } catch { /* noop */ }
      }

      if (result.startsWith("Error: approval_required")) {
        // "모두 승인"으로 등록된 도구면 즉시 재실행
        if (this.auto_approved_tools.has(name)) {
          return tool.execute({ ...effective_params, __approved: true }, context);
        }
        const request = this.create_approval_request(name, effective_params, context, result);
        await this.notify_approval_required(request);
        const response_hint = [
          "",
          `approval_request_id: ${request.request_id}`,
          "approval_reply_examples: 승인 / 모두 승인 / 거부 / 보류",
        ].join("\n");
        return `${result}\n${response_hint}`;
      }
      if (result.startsWith("Error:")) return `${result}${ERROR_HINT}`;
      return result;
    } catch (error) {
      return `Error executing ${name}: ${error_message(error)}${ERROR_HINT}`;
    }
  }

  private async trigger_approval_from_hook(
    tool_name: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext | undefined,
    reason: string,
  ): Promise<string> {
    const detail = `Error: approval_required\nreason: ${reason}\ntool: ${tool_name}`;
    const request = this.create_approval_request(tool_name, params, context, detail);
    await this.notify_approval_required(request);
    const response_hint = [
      "",
      `approval_request_id: ${request.request_id}`,
      "approval_reply_examples: ✅ / 👍 / yes / 승인 / 허용 / go | ❌ / 👎 / no / 거절 / 불가 / stop | ⏸️ / 보류 / later | ? / 이유",
    ].join("\n");
    return `${detail}\n${response_hint}`;
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
      request_id: short_id(),
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

  /**
   * 네이티브 백엔드 승인 브리지용: 승인 요청을 등록하고 사용자 응답을 Promise로 대기.
   * resolve_approval_request()가 호출되면 Promise가 resolve.
   */
  register_approval_with_callback(
    tool_name: string,
    detail: string,
    context?: ToolExecutionContext,
    timeout_ms = 300_000,
  ): { request_id: string; decision: Promise<ApprovalDecision> } {
    const request = this.create_approval_request(tool_name, {}, context, detail);
    request.bridge = true;
    void this.notify_approval_required(request);

    const decision = new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.approval_callbacks.delete(request.request_id);
        // 타임아웃된 요청의 상태도 cancelled로 갱신하여 유령 방지
        const req = this.approval_requests.get(request.request_id);
        if (req && req.status === "pending") {
          req.status = "cancelled";
          this.approval_requests.set(request.request_id, req);
        }
        resolve("cancel");
      }, timeout_ms);

      this.approval_callbacks.set(request.request_id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });

    return { request_id: request.request_id, decision };
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
    else if (parsed.decision === "approve_all") {
      status = "approved";
      this.auto_approved_tools.add(req.tool_name);
    }
    else if (parsed.decision === "deny") status = "denied";
    else if (parsed.decision === "defer") status = "deferred";
    else if (parsed.decision === "cancel") status = "cancelled";
    else if (parsed.decision === "clarify") status = "clarify";
    req.status = status;
    req.response_text = response_text;
    req.response_parsed = parsed;
    this.approval_requests.set(request_id, req);

    // 콜백이 있으면 호출 (네이티브 백엔드 브리지용)
    const cb = this.approval_callbacks.get(request_id);
    if (cb) {
      this.approval_callbacks.delete(request_id);
      cb(parsed.decision);
    }

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
    // SDK 브리지 모드: SDK가 도구 실행을 직접 관리 — 이중 실행 방지
    if (req.bridge) {
      return { ok: true, status: req.status, tool_name: req.tool_name, result: "bridge_approved" };
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
        error: error_message(error),
      };
    }
  }

  /** pending 상태에서 TTL을 초과한 approval 요청을 cancelled로 전환하고 정리. */
  expire_stale_approvals(ttl_ms = 600_000): number {
    const now = Date.now();
    let count = 0;
    for (const [id, req] of this.approval_requests) {
      if (req.status !== "pending") continue;
      const created = new Date(req.created_at).getTime();
      if (Number.isNaN(created) || now - created < ttl_ms) continue;
      req.status = "cancelled";
      this.approval_requests.set(id, req);
      const cb = this.approval_callbacks.get(id);
      if (cb) {
        this.approval_callbacks.delete(id);
        cb("cancel");
      }
      count++;
    }
    return count;
  }
}
