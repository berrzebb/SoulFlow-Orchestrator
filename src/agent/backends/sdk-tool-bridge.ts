/**
 * ToolLike → Claude Agent SDK in-process MCP 서버 브리지.
 * SDK 백엔드의 네이티브 tool loop에서 우리 등록 도구를 직접 호출 가능하게 한다.
 *
 * optional dependency: @anthropic-ai/claude-agent-sdk, zod 미설치 시 null 반환.
 */

import type { ToolLike, ToolExecutionContext, JsonSchema } from "../tools/types.js";

/** SDK mcpServers에 전달 가능한 in-process 서버 설정. */
export type SdkToolServerConfig = Record<string, unknown>;

/**
 * ToolLike 배열을 SDK in-process MCP 서버로 래핑.
 * @returns SDK mcpServers 값에 넣을 설정 객체 또는 null (SDK 미설치 시).
 */
export async function create_sdk_tool_server(
  name: string,
  tools: ToolLike[],
  context?: ToolExecutionContext,
): Promise<SdkToolServerConfig | null> {
  if (tools.length === 0) return null;

  try {
    const sdk = await import(/* webpackIgnore: true */ "@anthropic-ai/claude-agent-sdk");
    const create_server = sdk.createSdkMcpServer as SdkMcpServerFactory | undefined;
    const create_tool = sdk.tool as SdkToolFactory | undefined;
    if (!create_server || !create_tool) return null;

    const { z } = await import(/* webpackIgnore: true */ "zod");

    const sdk_tools = tools.map((t) =>
      create_tool!(
        t.name,
        t.description || t.name,
        json_schema_to_zod_shape(t.parameters, z),
        async (args: Record<string, unknown>) => {
          try {
            const result = await t.execute(args, context);
            return { content: [{ type: "text" as const, text: result }] };
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      ),
    );

    return create_server({ name, tools: sdk_tools });
  } catch {
    return null;
  }
}

/* ── JSON Schema → Zod shape 변환 ─────────────────────── */

type ZodModule = typeof import("zod");
type ZodTypeAny = import("zod").ZodTypeAny;

function json_schema_to_zod_shape(
  schema: JsonSchema,
  z: ZodModule["z"],
): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  const props = schema.properties || {};
  const required_set = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [key, prop_schema] of Object.entries(props)) {
    const base = json_prop_to_zod(prop_schema, z);
    shape[key] = required_set.has(key) ? base : base.optional();
  }
  return shape;
}

function json_prop_to_zod(prop: JsonSchema, z: ZodModule["z"]): ZodTypeAny {
  switch (prop.type) {
    case "string":
      if (Array.isArray(prop.enum) && prop.enum.length > 0) return z.enum(prop.enum as [string, ...string[]]);
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(prop.items ? json_prop_to_zod(prop.items, z) : z.unknown());
    case "object":
      if (prop.properties) {
        return z.object(json_schema_to_zod_shape(prop, z));
      }
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

/* ── SDK 함수 시그니처 (dynamic import용) ─────────────── */

type SdkMcpServerFactory = (opts: { name: string; tools: unknown[] }) => SdkToolServerConfig;
type SdkToolFactory = (name: string, desc: string, schema: Record<string, ZodTypeAny>, handler: unknown) => unknown;
