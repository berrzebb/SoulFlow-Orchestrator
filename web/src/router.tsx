import { Suspense } from "react";
import { createHashRouter } from "react-router-dom";
import { RootLayout } from "./layouts/root";
import { lazyRetry } from "./utils/lazy-retry";

/* Overview는 랜딩 페이지이므로 정적 import 유지 */
import OverviewPage from "./pages/overview";

/* 나머지 페이지는 lazy load로 코드 스플리팅 */
const ChannelsPage = lazyRetry(() => import("./pages/channels"));
const SecretsPage = lazyRetry(() => import("./pages/secrets"));
const OAuthPage = lazyRetry(() => import("./pages/oauth"));
const SettingsPage = lazyRetry(() => import("./pages/settings"));
const ChatPage = lazyRetry(() => import("./pages/chat"));
const ProvidersPage = lazyRetry(() => import("./pages/providers"));
const SetupPage = lazyRetry(() => import("./pages/setup"));
const WorkspacePage = lazyRetry(() => import("./pages/workspace/index"));
const WorkflowsPage = lazyRetry(() => import("./pages/workflows/index"));
const WorkflowDetailPage = lazyRetry(() => import("./pages/workflows/detail"));
const WorkflowBuilderPage = lazyRetry(() => import("./pages/workflows/builder"));
const KanbanPage = lazyRetry(() => import("./pages/kanban"));
const WbsPage = lazyRetry(() => import("./pages/wbs"));
const PromptingPage = lazyRetry(() => import("./pages/prompting/index"));

function PageFallback() {
  return (
    <div className="page page--center">
      <div className="skeleton skeleton-card" />
    </div>
  );
}

function lazify(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

export const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "setup", element: lazify(<SetupPage />) },
      { path: "channels", element: lazify(<ChannelsPage />) },
      { path: "providers", element: lazify(<ProvidersPage />) },
      { path: "secrets", element: lazify(<SecretsPage />) },
      { path: "oauth", element: lazify(<OAuthPage />) },
      { path: "settings", element: lazify(<SettingsPage />) },
      { path: "chat", element: lazify(<ChatPage />) },
      { path: "workspace", element: lazify(<WorkspacePage />) },
      { path: "workflows", element: lazify(<WorkflowsPage />) },
      { path: "workflows/new", element: lazify(<WorkflowBuilderPage />) },
      { path: "workflows/edit/:name", element: lazify(<WorkflowBuilderPage />) },
      { path: "workflows/:id", element: lazify(<WorkflowDetailPage />) },
      { path: "prompting", element: lazify(<PromptingPage />) },
      { path: "kanban", element: lazify(<KanbanPage />) },
      { path: "wbs", element: lazify(<WbsPage />) },
    ],
  },
]);
