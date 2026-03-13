/** 지도 도구 — 위치 맥락에서 Google Maps / Kakao Maps / Naver Maps 링크 생성. */

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

export class MapTool extends Tool {
  readonly name = "map";
  readonly category: ToolCategory = "data";
  readonly description =
    "Generates a map link for a location. Use when the user mentions a place, address, or asks for directions. " +
    "Supported providers: google (default), kakao, naver. " +
    "Returns a clickable URL with a short label.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "Place name or address (e.g. '서울 강남구 역삼동', 'Eiffel Tower')",
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

    return `[${label}](${url}) (${PROVIDER_LABELS[provider]})`;
  }
}
