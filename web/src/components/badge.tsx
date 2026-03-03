type Variant = "ok" | "warn" | "err" | "off" | "info";

function classify(status: string): Variant {
  const s = status.toLowerCase();
  if (s.includes("run") || s.includes("work")) return "warn";
  if (s.includes("complete") || s === "ok" || s === "active") return "ok";
  if (s.includes("fail") || s.includes("error") || s.includes("cancel")) return "err";
  if (s.includes("wait") || s === "idle") return "info";
  return "off";
}

export function Badge({ status, variant }: { status: string; variant?: Variant }) {
  const v = variant ?? classify(status);
  return <span className={`badge badge--${v}`}>{status}</span>;
}
