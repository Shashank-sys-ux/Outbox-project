const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const API_BASE = "https://slack.com/api";
const WEBHOOK_PREFIX = "https://hooks.slack.com/";
const REQUEST_TIMEOUT_MS = 8000;

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SlackInstallation {
  accessToken: string;
  scope: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  webhookUrl: string;
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly slackError: string,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

export class SlackWebhookError extends Error {
  constructor(
    readonly status: number,
    readonly responseText: string,
  ) {
    super(`Slack webhook responded with ${status}: ${responseText.slice(0, 200)}`);
    this.name = "SlackWebhookError";
  }

  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { channel?: string; channel_id?: string; url?: string };
}

export function isSlackWebhookUrl(value: string): boolean {
  return value.startsWith(WEBHOOK_PREFIX);
}

export class SlackOAuthClient {
  constructor(private readonly config: SlackOAuthConfig) {}

  authorizeUrl(state: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      scope: "incoming-webhook",
      redirect_uri: this.config.redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<SlackInstallation> {
    const response = await fetch(`${API_BASE}/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json()) as OAuthAccessResponse;
    if (!payload.ok) {
      throw new SlackApiError("Slack rejected the OAuth code exchange", payload.error ?? "unknown_error");
    }
    const webhook = payload.incoming_webhook;
    if (!payload.access_token || !payload.team?.id || !webhook?.url || !webhook.channel_id) {
      throw new SlackApiError("Slack response did not include an incoming webhook", "missing_webhook");
    }
    if (!isSlackWebhookUrl(webhook.url)) {
      throw new SlackApiError("Slack returned an unexpected webhook URL", "invalid_webhook");
    }
    return {
      accessToken: payload.access_token,
      scope: payload.scope ?? "incoming-webhook",
      teamId: payload.team.id,
      teamName: payload.team.name ?? payload.team.id,
      channelId: webhook.channel_id,
      channelName: webhook.channel ?? webhook.channel_id,
      webhookUrl: webhook.url,
    };
  }

  async revoke(accessToken: string): Promise<void> {
    await fetch(`${API_BASE}/auth.revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

export async function postToWebhook(webhookUrl: string, payload: object): Promise<void> {
  if (!isSlackWebhookUrl(webhookUrl)) {
    throw new SlackWebhookError(400, "Refusing to post to a non Slack URL");
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SlackWebhookError(response.status, await response.text());
  }
}
