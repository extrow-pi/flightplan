import { createBrowserRouter, RouterProvider } from "react-router";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import DashboardLayout from "./pages/dashboard/DashboardLayout";
import OverviewPage from "./pages/dashboard/OverviewPage";
import EventsPage from "./pages/dashboard/EventsPage";
import EventFormPage from "./pages/dashboard/EventFormPage";
import TemplatesPage from "./pages/dashboard/TemplatesPage";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <AuthPage mode="login" key="login" /> },
  { path: "/signup", element: <AuthPage mode="signup" key="signup" /> },
  {
    path: "/dashboard",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "events", element: <EventsPage /> },
      { path: "events/new", element: <EventFormPage /> },
      { path: "events/:id", element: <EventFormPage /> },
      { path: "templates", element: <TemplatesPage /> },
      { path: "templates/new", element: <EventFormPage kind="template" /> },
      { path: "templates/:id", element: <EventFormPage kind="template" /> },
    ],
  },
  { path: "*", element: <LandingPage /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
