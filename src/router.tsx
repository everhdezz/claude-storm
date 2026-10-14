import { createHashRouter } from "react-router";
import { WelcomeLayout } from "./features/welcome/WelcomeLayout";
import { ProjectsPane } from "./features/welcome/ProjectsPane";
import { ProjectPage } from "./features/project/ProjectPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";

/** Hash-based routes: the welcome shell and one route per project window. */
export const router = createHashRouter([
  {
    path: "/",
    element: <WelcomeLayout />,
    children: [{ index: true, element: <ProjectsPane /> }],
  },
  {
    path: "/project/:projectId",
    element: <ProjectPage />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
]);
