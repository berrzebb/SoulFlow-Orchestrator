/** MCP 클라이언트 매니저의 공개 타입 정의. */

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  startup_timeout_ms?: number;
};

export type McpToolEntry = {
  server_name: string;
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

export type McpCallResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  is_error: boolean;
};

export type McpServerStatus = {
  name: string;
  connected: boolean;
  tools: McpToolEntry[];
  error?: string;
};
