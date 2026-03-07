export interface ChannelInstance {
  provider: string;
  instance_id: string;
  label: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  last_error?: string;
  token_configured: boolean;
  default_target: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ModalMode = { kind: "add" } | { kind: "edit"; instance: ChannelInstance };

export interface ConfigField {
  path: string;
  value: unknown;
  type: string;
}

export interface ConfigResponse {
  raw: Record<string, unknown>;
  sections: Array<{ id: string; fields: ConfigField[] }>;
}

export const PROVIDER_OPTIONS = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
] as const;
