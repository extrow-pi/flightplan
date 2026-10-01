import { createBrowserRouter, RouterProvider } from "react-router";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import DashboardLayout from "./pages/dashboard/DashboardLayout";
import OverviewPage from "./pages/dashboard/OverviewPage";
import EventsPage from "./pages/dashboard/EventsPage";
import EventFormPage from "./pages/dashboard/EventFormPage";
import TemplatesPage from "./pages/dashboard/TemplatesPage";
import TablesPage from "./pages/dashboard/TablesPage";
import BookingPage from "./pages/BookingPage";
import RequestStatusPage from "./pages/RequestStatusPage";
import EmailLogPage from "./pages/dashboard/EmailLogPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";
import TeamPage from "./pages/dashboard/TeamPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import VendorsPage from "./pages/dashboard/VendorsPage";
import SettingsPage from "./pages/dashboard/SettingsPage";
import OrganizerPage from "./pages/OrganizerPage";

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
      { path: "events/:id/tables", element: <TablesPage /> },
      { path: "events/:id/team", element: <TeamPage /> },
      { path: "templates", element: <TemplatesPage /> },
      { path: "emails", element: <EmailLogPage /> },
      { path: "vendors", element: <VendorsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "templates/new", element: <EventFormPage kind="template" /> },
      { path: "templates/:id", element: <EventFormPage kind="template" /> },
      { path: "templates/:id/team", element: <TeamPage /> },
    ],
  },
  // Public vendor booking pages (no sign-in)
  { path: "/book/:token", element: <BookingPage kind="book" key="book" /> },
  { path: "/invite/:token", element: <BookingPage kind="invite" key="invite" /> },
  { path: "/booking/:requestId", element: <RequestStatusPage /> },
  // Organizer public pages (no sign-in)
  { path: "/o/:handle", element: <OrganizerPage /> },
  // Accept an invitation to collaborate on an event (asks to sign in first)
  { path: "/collaborate/:token", element: <AcceptInvitePage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "*", element: <LandingPage /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
