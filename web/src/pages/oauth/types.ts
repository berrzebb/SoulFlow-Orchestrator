export interface OAuthIntegration {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  token_configured: boolean;
  expired: boolean;
  expires_at: string | null;
  has_client_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface OAuthPreset {
  service_type: string;
  label: string;
  auth_url: string;
  token_url: string;
  scopes_available: string[];
  default_scopes: string[];
  supports_refresh: boolean;
  is_builtin?: boolean;
  token_auth_method?: "basic" | "body";
  scope_separator?: " " | ",";
  test_url?: string;
}

export type ModalMode = { kind: "add" } | { kind: "edit"; instance: OAuthIntegration };

export function parse_csv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
