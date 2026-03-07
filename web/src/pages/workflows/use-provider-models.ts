import { useState, useEffect } from "react";
import type { NodeOptions, ProviderModelInfo } from "./node-registry";

/**
 * backend(provider instance_id) 변경 시 해당 프로바이더의 모델 목록을 동적으로 조회.
 * fallback으로 options.models (Ollama 모델)를 사용.
 */
export function useProviderModels(
  backend: string | undefined,
  options?: NodeOptions,
): { models: ProviderModelInfo[]; loading: boolean } {
  const [models, setModels] = useState<ProviderModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!backend || !options?.fetch_provider_models) {
      // backend 미지정 시 fallback (Ollama 등 기본 모델 목록)
      const fallback = (options?.models || []).map((m) => ({
        id: m.name,
        name: m.name,
        provider: "default",
        purpose: "chat" as const,
      }));
      setModels(fallback);
      return;
    }

    let cancelled = false;
    setLoading(true);
    options.fetch_provider_models(backend).then((result) => {
      if (!cancelled) {
        setModels(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [backend, options?.fetch_provider_models, options?.models]);

  return { models, loading };
}
