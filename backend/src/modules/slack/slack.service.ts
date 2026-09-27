import { env, oauthRedirects } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { prisma } from "../../infra/prisma.js";
import { secretBox } from "../../infra/secrets.js";
import type { RateLimitAlertJobData } from "../../queues/queue.types.js";
import { randomToken } from "../../utils/crypto.js";
import { AppError } from "../../utils/errors.js";
import type { OAuthStateStore } from "../auth/oauth-state.store.js";
import { postToWebhook, SlackOAuthClient } from "./slack.client.js";

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
  connectedAt: string | null;
}

interface SlackInstallState {
  userId: string;
}

export const slackOAuth =
  env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET
    ? new SlackOAuthClient({
        clientId: env.SLACK_CLIENT_ID,
        clientSecret: env.SLACK_CLIENT_SECRET,
        redirectUri: oauthRedirects.slack,
      })
    : null;

function formatTime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function getSlackStatus(userId: string): Promise<SlackStatus> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  return {
    configured: slackOAuth !== null,
    connected: connection !== null,
    teamName: connection?.teamName ?? null,
    channelName: connection?.channelName ?? null,
    connectedAt: connection?.updatedAt.toISOString() ?? null,
  };
}

export async function startSlackInstall(states: OAuthStateStore, userId: string): Promise<string> {
  if (!slackOAuth) {
    throw AppError.serviceUnavailable("Slack is not configured on this server");
  }
  const state = randomToken(32);
  await states.save("slack", state, { userId } satisfies SlackInstallState);
  return slackOAuth.authorizeUrl(state);
}

export async function completeSlackInstall(
  states: OAuthStateStore,
  params: { state: string; code: string; sessionUserId: string | undefined },
): Promise<string> {
  if (!slackOAuth) {
    throw AppError.serviceUnavailable("Slack is not configured on this server");
  }
  const saved = await states.consume<SlackInstallState>("slack", params.state);
  if (!saved) {
    throw AppError.badRequest("Slack authorization expired or was already used");
  }
  if (params.sessionUserId && params.sessionUserId !== saved.userId) {
    throw AppError.forbidden("Slack authorization was started by a different user");
  }

  const installation = await slackOAuth.exchangeCode(params.code);
  const data = {
    teamId: installation.teamId,
    teamName: installation.teamName,
    channelId: installation.channelId,
    channelName: installation.channelName,
    scope: installation.scope,
    webhookUrlEncrypted: secretBox.encrypt(installation.webhookUrl),
    accessTokenEncrypted: secretBox.encrypt(installation.accessToken),
  };
  await prisma.slackConnection.upsert({
    where: { userId: saved.userId },
    create: { userId: saved.userId, ...data },
    update: data,
  });
  logger.info(
    { userId: saved.userId, teamId: installation.teamId, channelId: installation.channelId },
    "Slack connected",
  );

  await postToWebhook(installation.webhookUrl, {
    text: ":white_check_mark: Outbox Scheduler is connected. Rate limit alerts will be posted here.",
  }).catch((error: unknown) => logger.warn({ err: error }, "Slack welcome message failed"));

  return saved.userId;
}

export async function disconnectSlack(userId: string): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) {
    return;
  }
  if (slackOAuth) {
    await slackOAuth
      .revoke(secretBox.decrypt(connection.accessTokenEncrypted))
      .catch((error: unknown) => logger.warn({ err: error, userId }, "Slack token revoke failed"));
  }
  await prisma.slackConnection.delete({ where: { userId } });
  logger.info({ userId }, "Slack disconnected");
}

export async function sendSlackTestMessage(userId: string): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw AppError.notFound("Slack is not connected");
  }
  try {
    await postToWebhook(secretBox.decrypt(connection.webhookUrlEncrypted), {
      text: ":wave: Test message from Outbox Scheduler.",
    });
  } catch (error) {
    throw AppError.serviceUnavailable("Slack did not accept the test message", error);
  }
}

export function rateLimitMessage(alert: RateLimitAlertJobData): object {
  const scopeLabel =
    alert.scope === "sender"
      ? `Sender *${alert.senderEmail}* reached its hourly limit of *${alert.limit}* emails.`
      : `Campaign *${alert.campaignSubject}* on sender *${alert.senderEmail}* reached its hourly limit of *${alert.limit}* emails.`;
  const window = `${formatTime(alert.windowStart)} to ${formatTime(alert.windowEnd)}`;
  return {
    text: `Hourly limit reached for ${alert.senderEmail}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: ":warning: Hourly sending limit reached" } },
      { type: "section", text: { type: "mrkdwn", text: scopeLabel } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Window*\n${window}` },
          { type: "mrkdwn", text: `*Remaining emails resume*\n${formatTime(alert.retryAt)}` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "No emails were dropped. They were rescheduled into the next window." }],
      },
    ],
  };
}

export async function deliverRateLimitAlert(alert: RateLimitAlertJobData): Promise<"sent" | "not_connected"> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId: alert.userId } });
  if (!connection) {
    logger.info({ userId: alert.userId, senderId: alert.senderId }, "Slack not connected, skipping rate limit alert");
    return "not_connected";
  }
  await postToWebhook(secretBox.decrypt(connection.webhookUrlEncrypted), rateLimitMessage(alert));
  logger.info(
    { userId: alert.userId, senderId: alert.senderId, scope: alert.scope, windowStart: alert.windowStart },
    "Slack rate limit notification sent",
  );
  return "sent";
}
