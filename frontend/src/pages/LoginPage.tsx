import { Navigate, useSearchParams } from "react-router";
import { buttonClasses } from "../components/ui/Button";
import { FullPageSpinner } from "../components/ui/Spinner";
import { useAuth } from "../context/AuthContext";
import { useConfig } from "../hooks/queries";
import { authApi } from "../services/api";

const ERRORS: Record<string, string> = {
  access_denied: "Google sign in was cancelled.",
  invalid_state: "Your sign in session did not match. Please try again.",
  expired_state: "Your sign in attempt expired. Please try again.",
  email_not_verified: "Your Google email address is not verified.",
  google_not_configured: "Google sign in is not configured on the server yet.",
  nonce_mismatch: "Sign in could not be verified. Please try again.",
};

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/scheduled";
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const { user, loading } = useAuth();
  const config = useConfig();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const errorCode = params.get("error");

  if (loading) {
    return <FullPageSpinner />;
  }
  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  const googleDisabled = config.data ? !config.data.googleAuth : false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section aria-labelledby="login-title" className="w-full max-w-md rounded-2xl border border-line bg-white p-10 shadow-sm">
        <p className="text-center text-2xl font-black tracking-tight">ONB</p>
        <h1 id="login-title" className="mt-6 text-center text-3xl font-bold text-ink">
          Login
        </h1>
        <p className="mt-2 text-center text-sm text-muted">Schedule and track outbound email campaigns.</p>

        {errorCode ? (
          <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {ERRORS[errorCode] ?? "Sign in failed. Please try again."}
          </p>
        ) : null}

        {googleDisabled ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL in backend/.env.
          </p>
        ) : null}

        <a
          href={authApi.googleLoginUrl(returnTo)}
          aria-disabled={googleDisabled || undefined}
          className={buttonClasses(
            "secondary",
            "lg",
            `mt-8 w-full bg-brand-50 border-brand-100 text-ink hover:bg-brand-100 ${googleDisabled ? "pointer-events-none opacity-50" : ""}`,
          )}
        >
          <GoogleLogo />
          Login with Google
        </a>

        <p className="mt-6 text-center text-xs text-muted">
          We only read your name, email and profile picture from Google.
        </p>
      </section>
    </main>
  );
}
