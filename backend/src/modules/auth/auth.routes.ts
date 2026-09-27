import { Router, type CookieOptions } from "express";
import { appOrigin, env, oauthRedirects } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { randomToken, safeEqual, sha256Base64Url } from "../../utils/crypto.js";
import { queryString, requireUser, safeReturnTo } from "../../utils/http.js";
import { ensureDefaultSender } from "../senders/senders.service.js";
import { upsertGoogleUser } from "./auth.service.js";
import { GoogleOAuthClient, GoogleOAuthError } from "./google-oauth.client.js";
import type { OAuthStateStore } from "./oauth-state.store.js";
import type { SessionService } from "./session.service.js";

const STATE_COOKIE = "outbox_google_state";

interface GoogleLoginState {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

export function createAuthRouter(deps: { sessions: SessionService; oauthStates: OAuthStateStore }): Router {
  const router = Router();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? new GoogleOAuthClient({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: oauthRedirects.google,
        })
      : null;

  const stateCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 10 * 60 * 1000,
  };

  const loginFailed = (reason: string) => `${appOrigin}/login?error=${encodeURIComponent(reason)}`;

  router.get("/google", async (req, res) => {
    if (!google) {
      res.redirect(loginFailed("google_not_configured"));
      return;
    }
    const state = randomToken(32);
    const nonce = randomToken(32);
    const codeVerifier = randomToken(48);
    const returnTo = safeReturnTo(queryString(req, "returnTo"));

    await deps.oauthStates.save("google", state, { codeVerifier, nonce, returnTo } satisfies GoogleLoginState);
    res.cookie(STATE_COOKIE, state, stateCookieOptions);
    res.redirect(google.authorizationUrl({ state, nonce, codeChallenge: sha256Base64Url(codeVerifier) }));
  });

  router.get("/google/callback", async (req, res) => {
    const { maxAge: _maxAge, ...clearOptions } = stateCookieOptions;
    res.clearCookie(STATE_COOKIE, clearOptions);

    if (!google) {
      res.redirect(loginFailed("google_not_configured"));
      return;
    }
    const providerError = queryString(req, "error");
    if (providerError) {
      logger.warn({ providerError }, "Google login was cancelled or denied");
      res.redirect(loginFailed(providerError === "access_denied" ? "access_denied" : "oauth_failed"));
      return;
    }

    const state = queryString(req, "state") ?? "";
    const code = queryString(req, "code");
    const cookies = req.cookies as Record<string, string | undefined>;
    const cookieState = cookies[STATE_COOKIE] ?? "";
    if (!code || !state || !safeEqual(state, cookieState)) {
      logger.warn("Google callback rejected: state mismatch");
      res.redirect(loginFailed("invalid_state"));
      return;
    }

    const saved = await deps.oauthStates.consume<GoogleLoginState>("google", state);
    if (!saved) {
      res.redirect(loginFailed("expired_state"));
      return;
    }

    try {
      const profile = await google.exchangeCode({ code, codeVerifier: saved.codeVerifier, nonce: saved.nonce });
      const { user, isNewUser } = await upsertGoogleUser(profile);
      await deps.sessions.destroy(res, req.sessionId);
      await deps.sessions.create(res, user.id);
      await ensureDefaultSender(user.id).catch((error: unknown) =>
        logger.warn({ err: error, userId: user.id }, "Could not create default Ethereal sender"),
      );
      logger.info({ userId: user.id, isNewUser }, "User logged in with Google");
      res.redirect(`${appOrigin}${saved.returnTo}`);
    } catch (error) {
      const reason = error instanceof GoogleOAuthError ? error.reason : "oauth_failed";
      logger.error({ err: error, reason }, "Google login failed");
      res.redirect(loginFailed(reason));
    }
  });

  router.get("/me", (req, res) => {
    res.json({ data: requireUser(req) });
  });

  router.post("/logout", async (req, res) => {
    const userId = req.user?.id;
    await deps.sessions.destroy(res, req.sessionId);
    if (userId) {
      logger.info({ userId }, "User logged out");
    }
    res.status(204).end();
  });

  return router;
}
