import { createHashRouter } from "react-router-dom";
import { RootLayout } from "./layouts/root";

import OverviewPage from "./pages/overview";
import ChannelsPage from "./pages/channels";
import SecretsPage from "./pages/secrets";
import OAuthPage from "./pages/oauth";
import SettingsPage from "./pages/settings";
import ChatPage from "./pages/chat";
import ProvidersPage from "./pages/providers";
import SetupPage from "./pages/setup";
import WorkspacePage from "./pages/workspace/index";
import WorkflowsPage from "./pages/workflows/index";
import WorkflowDetailPage from "./pages/workflows/detail";
import WorkflowBuilderPage from "./pages/workflows/builder";

export const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "setup", element: <SetupPage /> },
      { path: "channels", element: <ChannelsPage /> },
      { path: "providers", element: <ProvidersPage /> },
      { path: "secrets", element: <SecretsPage /> },
      { path: "oauth", element: <OAuthPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "workspace", element: <WorkspacePage /> },
      { path: "workflows", element: <WorkflowsPage /> },
      { path: "workflows/new", element: <WorkflowBuilderPage /> },
      { path: "workflows/edit/:name", element: <WorkflowBuilderPage /> },
      { path: "workflows/:id", element: <WorkflowDetailPage /> },
    ],
  },
]);
