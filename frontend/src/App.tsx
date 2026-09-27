import { Link, Navigate, Route, Routes } from "react-router";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { buttonClasses } from "./components/ui/Button";
import { EmptyState } from "./components/ui/States";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { ComposePage } from "./pages/ComposePage";
import { EmailDetailPage } from "./pages/EmailDetailPage";
import { EmailsPage } from "./pages/EmailsPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist."
      action={
        <Link to="/scheduled" className={buttonClasses("primary", "md")}>
          Go to dashboard
        </Link>
      }
    />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<Navigate to="/scheduled" replace />} />
          <Route path="/scheduled" element={<EmailsPage key="scheduled" view="scheduled" />} />
          <Route path="/sent" element={<EmailsPage key="sent" view="sent" />} />
          <Route path="/emails/:emailId" element={<EmailDetailPage />} />
          <Route path="/compose" element={<ComposePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
