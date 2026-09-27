import { appOrigin, env, features, oauthRedirects } from "../src/config/env.js";
import { GoogleOAuthClient } from "../src/modules/auth/google-oauth.client.js";
import { randomToken, sha256Base64Url } from "../src/utils/crypto.js";

type Outcome = "ok" | "fail" | "warn";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 10_000;
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const OAUTH_ERROR_CODES = [
  "redirect_uri_mismatch",
  "invalid_client",
  "deleted_client",
  "disabled_client",
  "unauthorized_client",
  "org_internal",
  "invalid_request",
];

const HINTS: Record<string, string> = {
  redirect_uri_mismatch: `Add ${oauthRedirects.google} under Authorized redirect URIs in Google Cloud Console, then wait a minute`,
  invalid_client: "Google does not recognise this client. Re-copy GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the same OAuth client",
  deleted_client: "This OAuth client was deleted in Google Cloud Console. Create a new Web application client",
  disabled_client: "This OAuth client is disabled in Google Cloud Console",
  unauthorized_client: "The client type must be Web application",
  org_internal: "The consent screen is set to Internal. Switch it to External or use an account from that organisation",
};

let failures = 0;

function report(outcome: Outcome, check: string, detail: string): void {
  if (outcome === "fail") {
    failures += 1;
  }
  const label = outcome === "ok" ? "PASS" : outcome === "fail" ? "FAIL" : "WARN";
  console.log(`${label}  ${check}: ${detail}`);
}

function mask(value: string): string {
  return value.length <= 12 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function knownErrorIn(text: string): string | undefined {
  return OAUTH_ERROR_CODES.find((code) => text.includes(code));
}

function decodeAuthError(url: URL): string {
  const value = url.searchParams.get("authError");
  return value ? Buffer.from(value, "base64").toString("latin1") : "";
}

async function checkAuthorizationRequest(client: GoogleOAuthClient): Promise<void> {
  let url = new URL(
    client.authorizationUrl({
      state: randomToken(32),
      nonce: randomToken(32),
      codeChallenge: sha256Base64Url(randomToken(48)),
    }),
  );

  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      if (next.pathname.includes("/error")) {
        const code = knownErrorIn(`${next.href} ${decodeAuthError(next)}`) ?? knownErrorIn(await fetchText(next));
        report("fail", "Client ID and redirect URI", code ? `${code}. ${HINTS[code] ?? ""}` : "Google showed an OAuth error page");
        return;
      }
      if (/signin|servicelogin|oauthchooseaccount|identifier/i.test(next.pathname)) {
        report("ok", "Client ID and redirect URI", "Google accepted the login request and showed its sign in page");
        return;
      }
      url = next;
      continue;
    }

    const body = await response.text();
    const shownError = /Error \d{3}: ([a-z_]+)/.exec(body)?.[1];
    if (shownError) {
      report("fail", "Client ID and redirect URI", `${shownError}. ${HINTS[shownError] ?? ""}`);
      return;
    }
    report(
      response.ok ? "ok" : "warn",
      "Client ID and redirect URI",
      response.ok ? "Google returned its sign in page without an error" : `Unexpected HTTP ${response.status} from Google`,
    );
    return;
  }
  report("warn", "Client ID and redirect URI", "Too many redirects, open the login in a browser to confirm");
}

async function fetchText(url: URL): Promise<string> {
  try {
    const response = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return await response.text();
  } catch {
    return "";
  }
}

async function checkClientSecret(clientId: string, clientSecret: string): Promise<void> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: "outbox-configuration-check",
      code_verifier: randomToken(48),
      redirect_uri: oauthRedirects.google,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };

  if (payload.error === "invalid_grant") {
    report("ok", "Client secret", "Google authenticated the client (the fake code was rejected, as expected)");
  } else if (payload.error && HINTS[payload.error]) {
    report("fail", "Client secret", `${payload.error}. ${HINTS[payload.error]}`);
  } else {
    report("warn", "Client secret", `Unexpected answer: ${payload.error ?? response.status} ${payload.error_description ?? ""}`.trim());
  }
}

async function main(): Promise<void> {
  console.log(`Authorized JavaScript origin to register: ${appOrigin}`);
  console.log(`Authorized redirect URI to register:     ${oauthRedirects.google}`);
  console.log("");

  if (!features.googleAuth || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    report("fail", "Configuration", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are empty in backend/.env (is the file saved?)");
    return;
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  report("ok", "Configuration", `client ${mask(clientId)} loaded`);

  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    report(
      clientSecret.endsWith(".apps.googleusercontent.com") ? "fail" : "warn",
      "Client ID format",
      clientSecret.endsWith(".apps.googleusercontent.com")
        ? "The ID and secret look swapped"
        : "Expected something like 1234-abc.apps.googleusercontent.com",
    );
  }
  if (!clientSecret.startsWith("GOCSPX-")) {
    report("warn", "Client secret format", "Web client secrets usually start with GOCSPX-");
  }
  if (!oauthRedirects.google.startsWith(`${appOrigin}/`)) {
    report("warn", "Redirect URI", `It is not on APP_URL (${appOrigin}), so the session cookie will not reach the app`);
  }
  if (env.ADMIN_EMAILS.length === 0) {
    report("warn", "ADMIN_EMAILS", "Empty, so nobody can open the Bull Board queue dashboard");
  }

  const client = new GoogleOAuthClient({ clientId, clientSecret, redirectUri: oauthRedirects.google });
  try {
    await checkAuthorizationRequest(client);
    await checkClientSecret(clientId, clientSecret);
  } catch (error) {
    report("fail", "Network", `Could not reach Google: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main()
  .then(() => {
    console.log("");
    console.log(failures === 0 ? "Google OAuth looks correctly configured." : `${failures} problem(s) found.`);
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
