export function SplitPane({ left, right, showRight }: { left: React.ReactNode; right: React.ReactNode; showRight?: boolean }) {
  return (
    <div className={`ws-split${showRight ? " ws-split--detail" : ""}`}>
      <div className="ws-split__left">{left}</div>
      <div className="ws-split__right">{right}</div>
    </div>
  );
}
