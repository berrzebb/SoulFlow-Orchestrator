/** Leaflet 지도 임베드 — map 코드블록 JSON을 인터랙티브 지도로 렌더링. */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map-embed.css";

interface MapData {
  location?: string;
  lat?: number;
  lon?: number;
  label?: string;
  zoom?: number;
}

interface Coords { lat: number; lon: number }

function parse_map_json(raw: string): MapData | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const d = data as MapData;
    if (!d.location && (typeof d.lat !== "number" || typeof d.lon !== "number")) return null;
    return d;
  } catch {
    return null;
  }
}

/** Nominatim 클라이언트 측 geocoding — 서버 geocoding 실패 시 폴백. */
async function client_geocode(location: string): Promise<Coords | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1&accept-language=ko`;
    const res = await fetch(url, {
      headers: { "User-Agent": "SoulFlow/1.0 (map-embed)" },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export function MapBlock({ raw }: { raw: string }) {
  const container_ref = useRef<HTMLDivElement>(null);
  const map_ref = useRef<LeafletMap | null>(null);
  const [error, set_error] = useState<string | null>(null);

  const data = parse_map_json(raw);

  useEffect(() => {
    if (!data || !container_ref.current || map_ref.current) return;

    const label = data.label ?? data.location ?? "";
    const zoom = data.zoom ?? 15;

    async function init_map(coords: Coords) {
      if (!container_ref.current) return;
      const map = L.map(container_ref.current, { zoomControl: true }).setView(
        [coords.lat, coords.lon],
        zoom
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      // circleMarker — Vite 번들에서 기본 아이콘 PNG 경로 깨짐 방지
      L.circleMarker([coords.lat, coords.lon], {
        radius: 8,
        color: "#2563eb",
        fillColor: "#3b82f6",
        fillOpacity: 0.8,
        weight: 2,
      })
        .bindPopup(label || `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`)
        .addTo(map)
        .openPopup();
      map_ref.current = map;
    }

    if (typeof data.lat === "number" && typeof data.lon === "number") {
      // 서버 geocoding 성공 — 바로 렌더링
      init_map({ lat: data.lat, lon: data.lon }).catch(() => set_error("지도 렌더링 실패"));
    } else if (data.location) {
      // 서버 geocoding 실패 — 클라이언트에서 재시도
      client_geocode(data.location).then((coords) => {
        if (coords) return init_map(coords);
        set_error(`위치를 찾을 수 없습니다: ${data.location}`);
      }).catch(() => set_error("지도 로드 실패"));
    }

    return () => {
      map_ref.current?.remove();
      map_ref.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  if (!data) return null;
  if (error) return <p className="map-embed__error">{error}</p>;

  return (
    <div className="map-embed">
      <div ref={container_ref} className="map-embed__canvas" />
    </div>
  );
}
