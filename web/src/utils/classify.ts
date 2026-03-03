/** 에이전트 상태를 UI 분류로 변환 */
export function classify_agent(status: string): "offline" | "working" | "online" {
  const s = status.toLowerCase();
  if (s.includes("offline")) return "offline";
  if (s.includes("work") || s.includes("run")) return "working";
  return "online";
}
