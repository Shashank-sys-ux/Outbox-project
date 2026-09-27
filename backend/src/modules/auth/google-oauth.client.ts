import { OAuth2Client } from "google-auth-library";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleProfile {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type GoogleOAuthFailure = "missing_id_token" | "invalid_id_token" | "nonce_mismatch" | "email_not_verified";

export class GoogleOAuthError extends Error {
  constructor(
    readonly reason: GoogleOAuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export class GoogleOAuthClient {
  private readonly client: OAuth2Client;

  constructor(private readonly config: GoogleOAuthConfig) {
    this.client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
  }

  authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async exchangeCode(params: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleProfile> {
    const { tokens } = await this.client.getToken({ code: params.code, codeVerifier: params.codeVerifier });
    if (!tokens.id_token) {
      throw new GoogleOAuthError("missing_id_token", "Google did not return an ID token");
    }

    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new GoogleOAuthError("invalid_id_token", "ID token is missing subject or email");
    }
    if (payload.nonce !== params.nonce) {
      throw new GoogleOAuthError("nonce_mismatch", "ID token nonce does not match the login attempt");
    }
    if (payload.email_verified !== true) {
      throw new GoogleOAuthError("email_not_verified", "Google account email is not verified");
    }

    return {
      googleSub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name?.trim() || payload.email,
      avatarUrl: payload.picture ?? null,
    };
  }
}
