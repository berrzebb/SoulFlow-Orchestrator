/** 커맨드 메타데이터. 채널 플랫폼 등록 및 /help 텍스트 생성에 사용. */
export type CommandDescriptor = {
  name: string;
  description: string;
  usage?: string;
};

const DESCRIPTORS: readonly CommandDescriptor[] = [
  { name: "help", description: "사용 가능한 명령 목록", usage: "" },
  { name: "stop", description: "진행 중인 작업 중지", usage: "" },
  { name: "render", description: "렌더링 프로필 설정", usage: "<markdown|html|plain|status|reset>" },
  { name: "secret", description: "시크릿 저장소 관리", usage: "status|list|set|get|reveal|remove|encrypt|decrypt" },
  { name: "memory", description: "메모리 조회·검색", usage: "status|list|today|longterm|search <query>" },
  { name: "decision", description: "결정사항 관리", usage: "status|list|set <key> <value>" },
  { name: "promise", description: "약속(제약 조건) 관리", usage: "status|list|set <key> <value>" },
  { name: "cron", description: "예약 작업 관리", usage: "status|list|add|remove" },
  { name: "reload", description: "설정·도구·스킬 다시 불러오기", usage: "config|tools|skills" },
  { name: "status", description: "현재 상태 요약", usage: "| /tools | /skills" },
] as const;

/** 등록된 모든 커맨드의 메타데이터를 반환. */
export function get_command_descriptors(): CommandDescriptor[] {
  return [...DESCRIPTORS];
}

/** /help 표시용 텍스트를 생성. */
export function format_help_text(descriptors: CommandDescriptor[]): string {
  const header = "사용 가능한 공통 명령";
  const lines = descriptors.map((d) =>
    `- /${d.name}${d.usage ? ` ${d.usage}` : ""}`,
  );
  return [header, ...lines].join("\n");
}
