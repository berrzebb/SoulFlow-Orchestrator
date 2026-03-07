/** S3 노드 핸들러 — 워크플로우에서 S3호환 오브젝트 스토리지 연동. */

import type { NodeHandler } from "../node-registry.js";
import type { S3NodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const s3_handler: NodeHandler = {
  node_type: "s3",
  icon: "\u{1F4E6}",
  color: "#ff9900",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "S3 operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "list / get / put / delete / head / presign" },
    { name: "bucket", type: "string", description: "Bucket name" },
    { name: "key", type: "string", description: "Object key" },
  ],
  create_default: () => ({ action: "list", bucket: "", key: "", region: "us-east-1" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as S3NodeDefinition;
    try {
      const { S3Tool } = await import("../tools/s3.js");
      const tool = new S3Tool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "list",
        bucket: resolve_templates(n.bucket || "", tpl),
        key: resolve_templates(n.key || "", tpl),
        region: n.region || "us-east-1",
        endpoint: n.endpoint ? resolve_templates(n.endpoint, tpl) : undefined,
        access_key: n.access_key ? resolve_templates(n.access_key, tpl) : undefined,
        secret_key: n.secret_key ? resolve_templates(n.secret_key, tpl) : undefined,
        prefix: n.prefix ? resolve_templates(n.prefix, tpl) : undefined,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { data: result };
      return { output: { result: parsed, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as S3NodeDefinition;
    const warnings: string[] = [];
    if (!n.bucket) warnings.push("bucket is required");
    return { preview: { action: n.action, bucket: n.bucket, key: n.key }, warnings };
  },
};
