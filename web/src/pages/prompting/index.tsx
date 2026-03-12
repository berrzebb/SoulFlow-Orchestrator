/**
 * Prompting — 통합 도메인 메인 페이지.
 *
 * 탭 구성:
 *   Text    — 프롬프트 템플릿 단일 실행 ({{variable}} 지원)
 *   Image   — 이미지 생성 모델 실행
 *   Video   — 비디오 생성 모델 실행
 *   Agent   — 에이전트 설계 + 테스트 채팅
 *   Gallery — 에이전트 정의 갤러리 CRUD
 *   Compare — 여러 모델 병렬 비교
 */
import { useState } from "react";
import { TextPanel } from "./text-panel";
import { ImagePanel } from "./image-panel";
import { VideoPanel } from "./video-panel";
import { AgentPanel } from "./agent-panel";
import { GalleryPanel } from "./gallery-panel";
import { ComparePanel } from "./compare-panel";

type Tab = "text" | "image" | "video" | "agent" | "gallery" | "compare";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "text",    label: "Text",    icon: "T"  },
  { id: "image",   label: "Image",   icon: "◎"  },
  { id: "video",   label: "Video",   icon: "▷"  },
  { id: "agent",   label: "Agent",   icon: "🤖" },
  { id: "gallery", label: "Gallery", icon: "◈"  },
  { id: "compare", label: "Compare", icon: "⚖"  },
];

export default function PromptingPage() {
  const [tab, setTab] = useState<Tab>("text");
  const [agent_initial_id, setAgentInitialId] = useState<string | undefined>(undefined);

  const go_to_agent = (id?: string) => {
    setAgentInitialId(id ?? "__new__");
    setTab("agent");
  };

  return (
    <div className="ps-page">
      <nav className="ps-tabs" role="tablist" aria-label="Prompting Studio">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ps-tab${tab === t.id ? " ps-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="ps-tab__icon" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ps-body" role="tabpanel">
        {tab === "text"    && <TextPanel />}
        {tab === "image"   && <ImagePanel />}
        {tab === "video"   && <VideoPanel />}
        {tab === "agent"   && <AgentPanel initial_id={agent_initial_id} />}
        {tab === "gallery" && <GalleryPanel onGoToAgent={go_to_agent} />}
        {tab === "compare" && <ComparePanel />}
      </div>
    </div>
  );
}
