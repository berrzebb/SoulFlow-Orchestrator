export function SplitPane({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 12, height: "calc(100vh - 200px)", minHeight: 400 }}>
      <div style={{ background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {left}
      </div>
      <div style={{ background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {right}
      </div>
    </div>
  );
}
