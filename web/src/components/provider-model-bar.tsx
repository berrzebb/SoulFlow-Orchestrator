import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useT } from "../i18n";

interface ProviderInstanceInfo {
  instance_id: string;
  label: string;
  provider_type: string;
  connection_id: string;
  model: string;
  available: boolean;
}

interface ProviderModelInfo {
  id: string;
  name: string;
  provider: string;
  purpose: "chat" | "embedding" | "both";
  context_length?: number;
}

interface ProviderModelBarProps {
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
}

/**
 * 프로바이더 인스턴스와 모델을 선택하는 드롭다운 바.
 * - 프로바이더 인스턴스 선택 → 모델 목록 자동 로드
 * - 프로바이더 미지정(빈 문자열) 시 "Auto" (글로벌 설정 사용)
 */
export function ProviderModelBar({
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
}: ProviderModelBarProps) {
  const t = useT();
  const [instances, setInstances] = useState<ProviderInstanceInfo[]>([]);
  const [models, setModels] = useState<ProviderModelInfo[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // 프로바이더 인스턴스 목록 로드
  useEffect(() => {
    let cancelled = false;
    setLoadingInstances(true);
    api
      .get<ProviderInstanceInfo[]>("/api/config/provider-instances?purpose=chat")
      .then((data) => {
        if (!cancelled) {
          setInstances(data);
          setModels([]);
          onModelChange("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInstances([]);
          setModels([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingInstances(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onModelChange]);

  // 프로바이더 선택 시 모델 목록 로드
  useEffect(() => {
    if (!selectedProvider) {
      setModels([]);
      onModelChange("");
      return;
    }

    let cancelled = false;
    setLoadingModels(true);
    api
      .get<ProviderModelInfo[]>(
        `/api/agents/providers/${encodeURIComponent(selectedProvider)}/models`
      )
      .then((data) => {
        if (!cancelled) {
          setModels(data);
          // 기존 선택 모델이 목록에 없으면 첫 번째 모델로 설정
          if (data.length > 0 && !data.find((m) => m.id === selectedModel)) {
            onModelChange(data[0].id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModels([]);
          onModelChange("");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider, selectedModel, onModelChange]);

  const currentProvider = instances.find((i) => i.instance_id === selectedProvider);
  const providerLabel = selectedProvider
    ? currentProvider?.label || selectedProvider
    : t("chat.model_auto");

  return (
    <div className="provider-model-bar">
      <select
        className="input input--sm provider-model-bar__provider-select"
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={loadingInstances}
        aria-label={t("chat.provider_select")}
      >
        <option value="">{t("chat.model_auto")}</option>
        {instances.map((inst) => (
          <option key={inst.instance_id} value={inst.instance_id}>
            {inst.label}
          </option>
        ))}
      </select>

      <select
        className="input input--sm provider-model-bar__model-select"
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={!selectedProvider || loadingModels || models.length === 0}
        aria-label={t("chat.model_select")}
      >
        {selectedModel ? (
          <option value={selectedModel}>{selectedModel}</option>
        ) : (
          <option value="">{t("chat.model_loading")}</option>
        )}
        {models
          .filter((m) => m.id !== selectedModel)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
    </div>
  );
}
