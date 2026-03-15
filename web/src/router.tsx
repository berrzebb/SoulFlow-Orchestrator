import { Suspense } from "react";
import { createHashRouter } from "react-router-dom";
import { RootLayout } from "./layouts/root";
import { lazyRetry } from "./utils/lazy-retry";
import { PATHS } from "./router-paths";

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
const LoginPage = lazyRetry(() => import("./pages/login"));
const AdminPage = lazyRetry(() => import("./pages/admin/index"));

/** createHashRouter용 경로 변환: "/foo" → "foo", "/" → undefined (index route). */
function r(path: string): string | undefined {
  return path === "/" ? undefined : path.slice(1);
}

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
  /* 로그인 페이지: 사이드바/헤더 없이 독립 렌더링 */
  { path: r(PATHS.LOGIN), element: lazify(<LoginPage />) },
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: r(PATHS.SETUP), element: lazify(<SetupPage />) },
      { path: r(PATHS.CHANNELS), element: lazify(<ChannelsPage />) },
      { path: r(PATHS.PROVIDERS), element: lazify(<ProvidersPage />) },
      { path: r(PATHS.SECRETS), element: lazify(<SecretsPage />) },
      { path: r(PATHS.OAUTH), element: lazify(<OAuthPage />) },
      { path: r(PATHS.SETTINGS), element: lazify(<SettingsPage />) },
      { path: r(PATHS.CHAT), element: lazify(<ChatPage />) },
      { path: r(PATHS.WORKSPACE), element: lazify(<WorkspacePage />) },
      { path: r(PATHS.WORKFLOWS), element: lazify(<WorkflowsPage />) },
      { path: r(PATHS.WORKFLOWS_NEW), element: lazify(<WorkflowBuilderPage />) },
      { path: r(PATHS.WORKFLOWS_EDIT), element: lazify(<WorkflowBuilderPage />) },
      { path: r(PATHS.WORKFLOW_DETAIL), element: lazify(<WorkflowDetailPage />) },
      { path: r(PATHS.PROMPTING), element: lazify(<PromptingPage />) },
      { path: r(PATHS.KANBAN), element: lazify(<KanbanPage />) },
      { path: r(PATHS.WBS), element: lazify(<WbsPage />) },
      { path: r(PATHS.ADMIN), element: lazify(<AdminPage />) },
    ],
  },
]);
