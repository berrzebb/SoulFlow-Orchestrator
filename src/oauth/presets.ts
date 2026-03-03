/** OAuth 서비스 프리셋 레지스트리 — register_preset()으로 서비스별 파일에서 등록. */

export interface OAuthServicePreset {
  service_type: string;
  label: string;
  auth_url: string;
  token_url: string;
  scopes_available: string[];
  default_scopes: string[];
  supports_refresh: boolean;
  /** 빌트인 프리셋 여부 (providers/ 파일에서 등록). 커스텀은 undefined/false. */
  is_builtin?: boolean;
  /** 토큰 교환/갱신 시 client 자격증명 전달 방식. "basic" = Authorization 헤더, "body" = 요청 바디 (기본값). */
  token_auth_method?: "basic" | "body";
  /** 토큰 유효성 테스트에 사용할 API 엔드포인트. 미설정 시 테스트 생략. */
  test_url?: string;
  extra_auth_params?: Record<string, string>;
}

const _registry = new Map<string, OAuthServicePreset>();

/** 새 OAuth 서비스 프리셋 등록. 별도 파일에서 호출하여 확장 가능. */
export function register_preset(preset: OAuthServicePreset): void {
  _registry.set(preset.service_type, preset);
}

/** 등록된 프리셋 제거. 빌트인 프리셋도 제거 가능. */
export function unregister_preset(service_type: string): boolean {
  return _registry.delete(service_type);
}

/** service_type으로 프리셋 조회. */
export function get_preset(service_type: string): OAuthServicePreset | null {
  return _registry.get(service_type) ?? null;
}

/** 등록된 프리셋 목록 반환 (custom 포함). */
export function list_presets(): OAuthServicePreset[] {
  return [
    ..._registry.values(),
    {
      service_type: "custom",
      label: "Custom",
      auth_url: "",
      token_url: "",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
    },
  ];
}

