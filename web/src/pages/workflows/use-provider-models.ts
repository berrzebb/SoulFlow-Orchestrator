import { useState, useEffect, useMemo } from "react";
import type { NodeOptions, ProviderModelInfo } from "./node-registry";

/**
 * backend(provider instance_id) 변경 시 해당 프로바이더의 모델 목록을 동적으로 조회.
 * fallback으로 options.models (Ollama 모델)를 사용.
 */
export function useProviderModels(
  backend: string | undefined,
  options?: NodeOptions,
): { models: ProviderModelInfo[]; loading: boolean } {
  const [asyncModels, setAsyncModels] = useState<ProviderModelInfo[]>([]);
  // fetchedBackend 추적으로 loading을 렌더 중 파생 — effect 내 동기 setState 제거
  const [fetchedBackend, setFetchedBackend] = useState<string | undefined>(undefined);

  // 옵셔널 체인을 훅 바깥에서 구조분해 — deps 배열에서 안정적 참조 사용
  const fetch_provider_models = options?.fetch_provider_models;
  const option_models = options?.models;

  const fallback = useMemo(
    () => (option_models || []).map((m) => ({ id: m.name, name: m.name, provider: "default", purpose: "chat" as const })),
    [option_models],
  );

  useEffect(() => {
    if (!backend || !fetch_provider_models) return;
    let cancelled = false;
    fetch_provider_models(backend).then((result) => {
      if (!cancelled) { setAsyncModels(result); setFetchedBackend(backend); }
    });
    return () => { cancelled = true; };
  }, [backend, fetch_provider_models]);

  const models = backend ? asyncModels : fallback;
  const loading = !!backend && !!options?.fetch_provider_models && fetchedBackend !== backend;
  return { models, loading };
}
