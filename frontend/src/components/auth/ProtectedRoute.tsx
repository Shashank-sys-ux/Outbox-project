import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { ErrorState } from "../ui/States";
import { FullPageSpinner } from "../ui/Spinner";

export function ProtectedRoute() {
  const { user, loading, error } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullPageSpinner label="Checking your session" />;
  }
  if (error && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorState error={error} title="We could not load your session" onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <Outlet />;
}
