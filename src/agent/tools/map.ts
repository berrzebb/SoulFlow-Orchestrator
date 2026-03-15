/** 지도 도구 — 위치 맥락에서 Google Maps / Kakao Maps / Naver Maps 링크 + 임베드 생성. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolCategory } from "./types.js";

type MapProvider = "google" | "kakao" | "naver";

const PROVIDER_LABELS: Record<MapProvider, string> = {
  google: "Google Maps",
  kakao: "카카오맵",
  naver: "네이버 지도",
};

function build_link(location: string, provider: MapProvider): string {
  const q = encodeURIComponent(location);
  switch (provider) {
    case "google": return `https://maps.google.com/?q=${q}`;
    case "kakao":  return `https://map.kakao.com/?q=${q}`;
    case "naver":  return `https://map.naver.com/v5/search/${q}`;
  }
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Nominatim(OSM) 무료 지오코딩 — API 키 불필요. */
async function geocode(location: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1&accept-language=ko`;
    const res = await fetch(url, {
      headers: { "User-Agent": "SoulFlow/1.0 (map-tool)" },
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as NominatimResult[];
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export class MapTool extends Tool {
  readonly name = "map";
  readonly category: ToolCategory = "data";
  readonly description =
    "Generates a map link and embedded map preview for a location. " +
    "Use when the user mentions a place, address, or asks for directions. " +
    "Supported providers: google (default), kakao, naver. " +
    "Returns a clickable URL with an embedded interactive map. " +
    "PREFERRED: pass lat/lon directly for reliable results — use web_search to find coordinates first. " +
    "Nominatim geocoding is unreliable for Korean business names.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "Place name or address (e.g. '서울 강남구 역삼동', 'Eiffel Tower')",
      },
      lat: {
        type: "number",
        description: "Latitude. If provided with lon, skips geocoding for reliable placement.",
      },
      lon: {
        type: "number",
        description: "Longitude. If provided with lat, skips geocoding for reliable placement.",
      },
      provider: {
        type: "string",
        enum: ["google", "kakao", "naver"],
        description: "Map provider. Defaults to google.",
      },
      label: {
        type: "string",
        description: "Optional display label for the link. Defaults to the location name.",
      },
    },
    required: ["location"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const location = String(params.location ?? "").trim();
    if (!location) return "Error: location is required";

    const provider = (params.provider as MapProvider | undefined) ?? "google";
    const label = params.label ? String(params.label) : location;
    const url = build_link(location, provider);

    const link_line = `[${label}](${url}) (${PROVIDER_LABELS[provider]})`;

    // lat/lon이 직접 전달되면 geocoding 건너뜀 — 가장 신뢰성 높은 경로
    const direct_lat = typeof params.lat === "number" ? params.lat : null;
    const direct_lon = typeof params.lon === "number" ? params.lon : null;
    const coords = (direct_lat !== null && direct_lon !== null)
      ? { lat: direct_lat, lon: direct_lon }
      : await geocode(location);

    const map_data: Record<string, unknown> = { location, label, zoom: 15 };
    if (coords) {
      map_data.lat = coords.lat;
      map_data.lon = coords.lon;
    }
    const map_json = JSON.stringify(map_data);
    return `${link_line}\n\n\`\`\`map\n${map_json}\n\`\`\``;
  }
}
