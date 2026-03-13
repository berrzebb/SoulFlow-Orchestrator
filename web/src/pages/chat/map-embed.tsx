/** Leaflet 지도 임베드 — map 코드블록 JSON을 인터랙티브 지도로 렌더링. */
import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map-embed.css";

interface MapData {
  lat: number;
  lon: number;
  label?: string;
  zoom?: number;
}

function parse_map_json(raw: string): MapData | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as MapData).lat !== "number" ||
      typeof (data as MapData).lon !== "number"
    ) {
      return null;
    }
    return data as MapData;
  } catch {
    return null;
  }
}

export function MapBlock({ raw }: { raw: string }) {
  const container_ref = useRef<HTMLDivElement>(null);
  const map_ref = useRef<LeafletMap | null>(null);

  const data = parse_map_json(raw);

  useEffect(() => {
    if (!data || !container_ref.current || map_ref.current) return;

    const map = L.map(container_ref.current, { zoomControl: true }).setView(
      [data.lat, data.lon],
      data.zoom ?? 15
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    // circleMarker — Vite 번들에서 기본 아이콘 PNG 경로 깨짐 방지
    L.circleMarker([data.lat, data.lon], {
      radius: 8,
      color: "#2563eb",
      fillColor: "#3b82f6",
      fillOpacity: 0.8,
      weight: 2,
    })
      .bindPopup(data.label ?? `${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`)
      .addTo(map)
      .openPopup();

    map_ref.current = map;

    return () => {
      map_ref.current?.remove();
      map_ref.current = null;
    };
  }, [data?.lat, data?.lon, data?.zoom, data?.label]);

  if (!data) return null;

  return (
    <div className="map-embed">
      <div ref={container_ref} className="map-embed__canvas" />
    </div>
  );
}
