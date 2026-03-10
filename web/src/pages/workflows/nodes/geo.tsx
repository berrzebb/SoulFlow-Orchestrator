import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const GEO_ACTIONS = ["distance", "bearing", "midpoint", "bbox", "geohash_encode", "geohash_decode", "dms_to_decimal"] as const;

function GeoEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "distance");
  const needs_coord2 = action === "distance" || action === "bearing" || action === "midpoint";
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {GEO_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {action === "geohash_decode" ? (
        <BuilderField label={t("workflows.geo_geohash")} required>
          <input className="input" value={String(node.geohash || "")} onChange={(e) => update({ geohash: e.target.value })} placeholder="u4pruydqqvj" />
        </BuilderField>
      ) : action === "dms_to_decimal" ? (
        <BuilderField label={t("workflows.geo_dms")} required>
          <input className="input" value={String(node.dms || "")} onChange={(e) => update({ dms: e.target.value })} placeholder={"37°33'36\"N"} />
        </BuilderField>
      ) : (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.geo_lat1")} required>
              <input className="input input--sm" type="number" step="any" value={String(node.lat1 ?? "")} onChange={(e) => update({ lat1: Number(e.target.value) })} placeholder="37.5665" />
            </BuilderField>
            <BuilderField label={t("workflows.geo_lon1")} required>
              <input className="input input--sm" type="number" step="any" value={String(node.lon1 ?? "")} onChange={(e) => update({ lon1: Number(e.target.value) })} placeholder="126.9780" />
            </BuilderField>
          </BuilderRowPair>
          {needs_coord2 && (
            <BuilderRowPair>
              <BuilderField label={t("workflows.geo_lat2")} required>
                <input className="input input--sm" type="number" step="any" value={String(node.lat2 ?? "")} onChange={(e) => update({ lat2: Number(e.target.value) })} placeholder="35.6762" />
              </BuilderField>
              <BuilderField label={t("workflows.geo_lon2")} required>
                <input className="input input--sm" type="number" step="any" value={String(node.lon2 ?? "")} onChange={(e) => update({ lon2: Number(e.target.value) })} placeholder="139.6503" />
              </BuilderField>
            </BuilderRowPair>
          )}
          {action === "bbox" && (
            <BuilderField label={t("workflows.geo_radius_km")}>
              <input className="input input--sm" type="number" min={0} value={String(node.radius_km ?? 10)} onChange={(e) => update({ radius_km: Number(e.target.value) })} />
            </BuilderField>
          )}
          {action === "geohash_encode" && (
            <BuilderField label={t("workflows.geo_precision")} hint={t("workflows.geo_precision_hint")}>
              <input className="input input--sm" type="number" min={1} max={12} value={String(node.precision ?? 9)} onChange={(e) => update({ precision: Number(e.target.value) })} />
            </BuilderField>
          )}
        </>
      )}
    </>
  );
}

export const geo_descriptor: FrontendNodeDescriptor = {
  node_type: "geo",
  icon: "\u{1F5FA}",
  color: "#2e7d32",
  shape: "rect",
  toolbar_label: "node.geo.label",
  category: "data",
  output_schema: [
    { name: "km",      type: "number", description: "node.geo.output.km" },
    { name: "miles",   type: "number", description: "node.geo.output.miles" },
    { name: "geohash", type: "string", description: "node.geo.output.geohash" },
    { name: "lat",     type: "number", description: "node.geo.output.lat" },
    { name: "lon",     type: "number", description: "node.geo.output.lon" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.geo.input.action" },
    { name: "lat1",   type: "number", description: "node.geo.input.lat1" },
    { name: "lon1",   type: "number", description: "node.geo.input.lon1" },
  ],
  create_default: () => ({ action: "distance", lat1: 0, lon1: 0, lat2: 0, lon2: 0, radius_km: 10, precision: 9, geohash: "", dms: "" }),
  EditPanel: GeoEditPanel,
};
