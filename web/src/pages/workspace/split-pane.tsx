export function SplitPane({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="ws-split">
      <div className="ws-split__left">{left}</div>
      <div className="ws-split__right">{right}</div>
    </div>
  );
}
