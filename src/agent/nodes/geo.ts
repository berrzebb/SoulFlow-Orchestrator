/** Geo 노드 핸들러 — 좌표 거리 계산/방위각/geohash. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

interface GeoNodeDefinition extends OrcheNodeDefinition {
  action?: string;
  lat1?: number;
  lon1?: number;
  lat2?: number;
  lon2?: number;
  radius_km?: number;
  precision?: number;
  geohash?: string;
  dms?: string;
}

export const geo_handler: NodeHandler = {
  node_type: "geo",
  icon: "\u{1F5FA}",
  color: "#2e7d32",
  shape: "rect",
  output_schema: [
    { name: "km",     type: "number", description: "Distance in kilometers" },
    { name: "miles",  type: "number", description: "Distance in miles" },
    { name: "geohash", type: "string", description: "Geohash string" },
    { name: "lat",    type: "number", description: "Decoded latitude" },
    { name: "lon",    type: "number", description: "Decoded longitude" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "distance/bearing/midpoint/bbox/geohash_encode/geohash_decode/dms_to_decimal" },
    { name: "lat1",   type: "number", description: "Latitude 1" },
    { name: "lon1",   type: "number", description: "Longitude 1" },
  ],
  create_default: () => ({ action: "distance", lat1: 0, lon1: 0, lat2: 0, lon2: 0, radius_km: 10, precision: 9, geohash: "", dms: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as GeoNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { GeoTool } = await import("../tools/geo.js");
      const tool = new GeoTool();
      const raw = await tool.execute({
        action:    n.action || "distance",
        lat1:      n.lat1,
        lon1:      n.lon1,
        lat2:      n.lat2,
        lon2:      n.lon2,
        radius_km: n.radius_km,
        precision: n.precision,
        geohash:   resolve_templates(n.geohash || "", tpl) || undefined,
        dms:       resolve_templates(n.dms || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as GeoNodeDefinition;
    const warnings: string[] = [];
    const needs_coords = ["distance", "bearing", "midpoint", "bbox", "geohash_encode"];
    if (needs_coords.includes(n.action || "distance")) {
      if (n.lat1 === undefined || n.lon1 === undefined) warnings.push("lat1/lon1 are required");
      if (["distance", "bearing", "midpoint"].includes(n.action || "") && (n.lat2 === undefined || n.lon2 === undefined)) {
        warnings.push("lat2/lon2 are required");
      }
    }
    return { preview: { action: n.action }, warnings };
  },
};
