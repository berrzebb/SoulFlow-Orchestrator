/** Geo 도구 — 좌표 거리 계산/방위각/중심점/바운딩박스/geohash. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class GeoTool extends Tool {
  readonly name = "geo";
  readonly category = "data" as const;
  readonly description = "Geolocation utilities: distance, bearing, midpoint, bbox, geohash_encode, geohash_decode, dms_to_decimal.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["distance", "bearing", "midpoint", "bbox", "geohash_encode", "geohash_decode", "dms_to_decimal"], description: "Geo operation" },
      lat1: { type: "number", description: "Latitude 1" },
      lon1: { type: "number", description: "Longitude 1" },
      lat2: { type: "number", description: "Latitude 2" },
      lon2: { type: "number", description: "Longitude 2" },
      radius_km: { type: "number", description: "Radius for bbox (km)" },
      precision: { type: "integer", description: "Geohash precision (default: 9)" },
      geohash: { type: "string", description: "Geohash string to decode" },
      dms: { type: "string", description: "DMS string (e.g. 37°33'36\"N)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly R = 6371;
  private readonly DEG = Math.PI / 180;

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "distance");

    switch (action) {
      case "distance": {
        const { lat1, lon1, lat2, lon2 } = this.coords(params);
        const d = this.haversine(lat1, lon1, lat2, lon2);
        return JSON.stringify({ km: Math.round(d * 1000) / 1000, miles: Math.round(d * 0.621371 * 1000) / 1000, meters: Math.round(d * 1000) });
      }
      case "bearing": {
        const { lat1, lon1, lat2, lon2 } = this.coords(params);
        const dLon = (lon2 - lon1) * this.DEG;
        const y = Math.sin(dLon) * Math.cos(lat2 * this.DEG);
        const x = Math.cos(lat1 * this.DEG) * Math.sin(lat2 * this.DEG) - Math.sin(lat1 * this.DEG) * Math.cos(lat2 * this.DEG) * Math.cos(dLon);
        const bearing = ((Math.atan2(y, x) / this.DEG) + 360) % 360;
        return JSON.stringify({ bearing: Math.round(bearing * 100) / 100, compass: this.bearing_to_compass(bearing) });
      }
      case "midpoint": {
        const { lat1, lon1, lat2, lon2 } = this.coords(params);
        const dLon = (lon2 - lon1) * this.DEG;
        const Bx = Math.cos(lat2 * this.DEG) * Math.cos(dLon);
        const By = Math.cos(lat2 * this.DEG) * Math.sin(dLon);
        const lat3 = Math.atan2(Math.sin(lat1 * this.DEG) + Math.sin(lat2 * this.DEG), Math.sqrt((Math.cos(lat1 * this.DEG) + Bx) ** 2 + By ** 2));
        const lon3 = lon1 * this.DEG + Math.atan2(By, Math.cos(lat1 * this.DEG) + Bx);
        return JSON.stringify({ lat: Math.round(lat3 / this.DEG * 1e6) / 1e6, lon: Math.round(lon3 / this.DEG * 1e6) / 1e6 });
      }
      case "bbox": {
        const lat = Number(params.lat1) || 0;
        const lon = Number(params.lon1) || 0;
        const radius = Number(params.radius_km) || 1;
        const dlat = radius / this.R / this.DEG;
        const dlon = radius / (this.R * Math.cos(lat * this.DEG)) / this.DEG;
        return JSON.stringify({
          min_lat: Math.round((lat - dlat) * 1e6) / 1e6,
          max_lat: Math.round((lat + dlat) * 1e6) / 1e6,
          min_lon: Math.round((lon - dlon) * 1e6) / 1e6,
          max_lon: Math.round((lon + dlon) * 1e6) / 1e6,
        });
      }
      case "geohash_encode": {
        const lat = Number(params.lat1) || 0;
        const lon = Number(params.lon1) || 0;
        const precision = Math.max(1, Math.min(Number(params.precision) || 9, 12));
        return JSON.stringify({ geohash: this.geohash_encode(lat, lon, precision) });
      }
      case "geohash_decode": {
        const hash = String(params.geohash || "");
        if (!hash) return "Error: geohash is required";
        const result = this.geohash_decode(hash);
        return JSON.stringify(result);
      }
      case "dms_to_decimal": {
        const dms = String(params.dms || "");
        const match = dms.match(/(\d+)[°]\s*(\d+)[′']\s*(\d+(?:\.\d+)?)[″"]?\s*([NSEW])/i);
        if (!match) return "Error: invalid DMS format (e.g. 37°33'36\"N)";
        let decimal = Number(match[1]) + Number(match[2]) / 60 + Number(match[3]) / 3600;
        if (match[4]!.toUpperCase() === "S" || match[4]!.toUpperCase() === "W") decimal = -decimal;
        return JSON.stringify({ decimal: Math.round(decimal * 1e6) / 1e6 });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private coords(params: Record<string, unknown>) {
    return { lat1: Number(params.lat1) || 0, lon1: Number(params.lon1) || 0, lat2: Number(params.lat2) || 0, lon2: Number(params.lon2) || 0 };
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = (lat2 - lat1) * this.DEG;
    const dLon = (lon2 - lon1) * this.DEG;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * this.DEG) * Math.cos(lat2 * this.DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * this.R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private bearing_to_compass(deg: number): string {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(deg / 22.5) % 16]!;
  }

  private geohash_encode(lat: number, lon: number, precision: number): string {
    const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const lat_range = [-90, 90], lon_range = [-180, 180];
    let hash = "", bits = 0, ch = 0, even = true;
    while (hash.length < precision) {
      const range = even ? lon_range : lat_range;
      const val = even ? lon : lat;
      const mid = (range[0]! + range[1]!) / 2;
      if (val >= mid) { ch = (ch << 1) | 1; range[0] = mid; }
      else { ch = ch << 1; range[1] = mid; }
      even = !even;
      bits++;
      if (bits === 5) { hash += base32[ch]; bits = 0; ch = 0; }
    }
    return hash;
  }

  private geohash_decode(hash: string): { lat: number; lon: number; lat_err: number; lon_err: number } {
    const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const lat_range = [-90, 90], lon_range = [-180, 180];
    let even = true;
    for (const c of hash) {
      const val = base32.indexOf(c);
      for (let i = 4; i >= 0; i--) {
        const bit = (val >> i) & 1;
        const range = even ? lon_range : lat_range;
        const mid = (range[0]! + range[1]!) / 2;
        if (bit === 1) range[0] = mid;
        else range[1] = mid;
        even = !even;
      }
    }
    return {
      lat: Math.round((lat_range[0]! + lat_range[1]!) / 2 * 1e6) / 1e6,
      lon: Math.round((lon_range[0]! + lon_range[1]!) / 2 * 1e6) / 1e6,
      lat_err: Math.round((lat_range[1]! - lat_range[0]!) / 2 * 1e6) / 1e6,
      lon_err: Math.round((lon_range[1]! - lon_range[0]!) / 2 * 1e6) / 1e6,
    };
  }
}
