import { createHashRouter } from "react-router";
import { WelcomeLayout } from "./features/welcome/WelcomeLayout";
import { ProjectsPane } from "./features/welcome/ProjectsPane";
import { ProjectPage } from "./features/project/ProjectPage";
import { ChatHome } from "./features/sessions/ChatHome";
import { SessionView } from "./features/sessions/SessionView";

/** Hash-based routes: the welcome shell and, per project window, the chat home or a session. */
export const router = createHashRouter([
  {
    path: "/",
    element: <WelcomeLayout />,
    children: [{ index: true, element: <ProjectsPane /> }],
  },
  {
    path: "/project/:projectId",
    element: <ProjectPage />,
    children: [
      { index: true, element: <ChatHome /> },
      { path: "session/:sessionId", element: <SessionView /> },
    ],
  },
]);
