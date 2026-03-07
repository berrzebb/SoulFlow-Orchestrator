import { t } from "../../i18n/index.js";

/** 서브커맨드 메타데이터. description은 i18n 키. */
export type SubcommandDescriptor = {
  name: string;
  description: string;
  usage?: string;
};

/** 커맨드 메타데이터. description은 i18n 키. 채널 플랫폼 등록 및 /help 텍스트 생성에 사용. */
export type CommandDescriptor = {
  name: string;
  description: string;
  usage?: string;
  subcommands?: SubcommandDescriptor[];
};

/** i18n 키를 자동 생성하는 헬퍼. */
function cmd(name: string, opts?: { usage?: string; subcommands?: Array<{ name: string; usage?: string }> }): CommandDescriptor {
  const subs = opts?.subcommands?.map((s) => ({
    name: s.name,
    description: `cmd.${name}.sub.${s.name}.desc`,
    ...(s.usage ? { usage: s.usage } : {}),
  }));
  return {
    name,
    description: `cmd.${name}.desc`,
    ...(opts?.usage ? { usage: opts.usage } : {}),
    ...(subs ? { subcommands: subs } : {}),
  };
}

const DESCRIPTORS: readonly CommandDescriptor[] = [
  cmd("help"),
  cmd("stop"),
  cmd("render", {
    subcommands: [
      { name: "markdown" },
      { name: "html" },
      { name: "plain" },
      { name: "status" },
      { name: "reset" },
    ],
  }),
  cmd("secret", {
    subcommands: [
      { name: "status" },
      { name: "list" },
      { name: "set", usage: "<name> <value>" },
      { name: "get", usage: "<name>" },
      { name: "reveal", usage: "<name>" },
      { name: "remove", usage: "<name>" },
      { name: "encrypt", usage: "<text>" },
      { name: "decrypt", usage: "<cipher>" },
    ],
  }),
  cmd("memory", {
    subcommands: [
      { name: "status" },
      { name: "list" },
      { name: "today" },
      { name: "longterm" },
      { name: "search", usage: "<query>" },
    ],
  }),
  cmd("decision", {
    subcommands: [
      { name: "status" },
      { name: "list" },
      { name: "set", usage: "<key> <value>" },
    ],
  }),
  cmd("promise", {
    subcommands: [
      { name: "status" },
      { name: "list" },
      { name: "set", usage: "<key> <value>" },
    ],
  }),
  cmd("cron", {
    subcommands: [
      { name: "status" },
      { name: "list" },
      { name: "add", usage: "every|at|cron <schedule> <message>" },
      { name: "remove", usage: "<job_id>" },
      { name: "pause" },
      { name: "resume" },
      { name: "stop" },
      { name: "nuke" },
    ],
  }),
  cmd("reload", {
    subcommands: [
      { name: "config" },
      { name: "tools" },
      { name: "skills" },
    ],
  }),
  cmd("task", {
    subcommands: [
      { name: "list" },
      { name: "status", usage: "<id>" },
      { name: "cancel", usage: "<id|all>" },
      { name: "recent" },
    ],
  }),
  cmd("status", { usage: "| /tools | /skills" }),
  cmd("skill", {
    subcommands: [
      { name: "list" },
      { name: "info", usage: "<name>" },
      { name: "roles" },
      { name: "recommend", usage: "<task>" },
      { name: "refresh" },
    ],
  }),
  cmd("doctor", {
    subcommands: [
      { name: "providers" },
      { name: "mcp" },
    ],
  }),
  cmd("agent", {
    subcommands: [
      { name: "running" },
      { name: "status", usage: "<id>" },
      { name: "cancel", usage: "<id|all>" },
      { name: "send", usage: "<id> <text>" },
    ],
  }),
  cmd("stats", {
    subcommands: [
      { name: "cd" },
      { name: "reset" },
    ],
  }),
  cmd("verify", { usage: "[<criteria>]" }),
  cmd("guard", {
    subcommands: [
      { name: "on" },
      { name: "off" },
    ],
  }),
  cmd("workflow", {
    subcommands: [
      { name: "list" },
      { name: "status", usage: "<id>" },
      { name: "run", usage: "<objective>" },
      { name: "cancel", usage: "<id>" },
      { name: "templates" },
    ],
  }),
  cmd("model", {
    subcommands: [
      { name: "list" },
      { name: "set", usage: "<model_name>" },
    ],
  }),
  cmd("mcp", {
    subcommands: [
      { name: "list" },
      { name: "reconnect", usage: "<name>" },
    ],
  }),
] as const;

/** 등록된 모든 커맨드의 메타데이터를 반환. */
export function get_command_descriptors(): CommandDescriptor[] {
  return [...DESCRIPTORS];
}

/** 커맨드 이름으로 descriptor를 조회. */
export function get_command_descriptor(name: string): CommandDescriptor | null {
  return DESCRIPTORS.find((d) => d.name === name) ?? null;
}

/** 특정 서브커맨드의 사용법 한 줄을 생성. */
export function format_subcommand_usage(command: string, subcommand: string): string {
  const desc = get_command_descriptor(command);
  const sub = desc?.subcommands?.find((s) => s.name === subcommand);
  if (!sub) return `/${command} ${subcommand}`;
  return `/${command} ${sub.name}${sub.usage ? ` ${sub.usage}` : ""} — ${t(sub.description)}`;
}

/** 세부 기능 안내 텍스트를 생성. subcommands가 없으면 null. */
export function format_subcommand_guide(name: string): string | null {
  const desc = get_command_descriptor(name);
  if (!desc?.subcommands?.length) return null;
  const lines = desc.subcommands.map((s) =>
    `- /${name} ${s.name}${s.usage ? ` ${s.usage}` : ""} — ${t(s.description)}`,
  );
  return [`/${name}: ${t(desc.description)}`, "", ...lines].join("\n");
}

/** /help 표시용 텍스트를 생성. */
export function format_help_text(descriptors: CommandDescriptor[]): string {
  const header = t("cmd._header");
  const lines = descriptors.map((d) => {
    if (d.subcommands?.length) return `- /${d.name} — ${t(d.description)} (${t("cmd._sub_count", { count: d.subcommands.length })})`;
    return `- /${d.name}${d.usage ? ` ${d.usage}` : ""} — ${t(d.description)}`;
  });
  return [header, ...lines, "", t("cmd._footer")].join("\n");
}
