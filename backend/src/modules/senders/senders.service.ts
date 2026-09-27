import { env, features } from "../../config/env.js";
import type { Sender } from "../../generated/prisma/client.js";
import { logger } from "../../infra/logger.js";
import { mailer } from "../../infra/mailer.js";
import { prisma } from "../../infra/prisma.js";
import { secretBox } from "../../infra/secrets.js";
import { AppError } from "../../utils/errors.js";
import { createEtherealAccount, SmtpDeliveryError, textToHtml, type SmtpSettings } from "../delivery/smtp-mailer.js";

export interface SenderView {
  id: string;
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  isEthereal: boolean;
  createdAt: string;
}

export interface CreateSmtpSenderInput {
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
}

export function toSenderView(sender: Sender): SenderView {
  return {
    id: sender.id,
    displayName: sender.displayName,
    email: sender.email,
    smtpHost: sender.smtpHost,
    smtpPort: sender.smtpPort,
    smtpSecure: sender.smtpSecure,
    smtpUser: sender.smtpUser,
    isEthereal: sender.smtpHost.toLowerCase().includes("ethereal.email"),
    createdAt: sender.createdAt.toISOString(),
  };
}

export function smtpSettingsOf(sender: Sender): SmtpSettings {
  return {
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    user: sender.smtpUser,
    password: secretBox.decrypt(sender.smtpPasswordEncrypted),
  };
}

export function transportCacheKey(sender: Sender): string {
  return `${sender.id}@${sender.updatedAt.getTime()}`;
}

async function assertUniqueEmail(userId: string, email: string): Promise<void> {
  const existing = await prisma.sender.findUnique({ where: { userId_email: { userId, email } } });
  if (existing) {
    throw AppError.conflict(`A sender with email ${email} already exists`);
  }
}

export async function listSenders(userId: string): Promise<SenderView[]> {
  const senders = await prisma.sender.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return senders.map(toSenderView);
}

export async function getOwnedSender(userId: string, senderId: string): Promise<Sender> {
  const sender = await prisma.sender.findFirst({ where: { id: senderId, userId } });
  if (!sender) {
    throw AppError.notFound("Sender not found");
  }
  return sender;
}

export async function createSmtpSender(userId: string, input: CreateSmtpSenderInput): Promise<SenderView> {
  const email = input.email.toLowerCase();
  await assertUniqueEmail(userId, email);
  const settings: SmtpSettings = {
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecure,
    user: input.smtpUser,
    password: input.smtpPassword,
  };
  try {
    await mailer.verify(settings);
  } catch (error) {
    const message = error instanceof SmtpDeliveryError ? error.message : "Could not connect to the SMTP server";
    throw AppError.badRequest(`SMTP verification failed: ${message}`);
  }
  const sender = await prisma.sender.create({
    data: {
      userId,
      displayName: input.displayName,
      email,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUser: input.smtpUser,
      smtpPasswordEncrypted: secretBox.encrypt(input.smtpPassword),
    },
  });
  logger.info({ userId, senderId: sender.id }, "SMTP sender created");
  return toSenderView(sender);
}

async function saveEtherealSender(userId: string, displayName: string, settings: SmtpSettings): Promise<Sender> {
  return prisma.sender.create({
    data: {
      userId,
      displayName,
      email: settings.user.toLowerCase(),
      smtpHost: settings.host,
      smtpPort: settings.port,
      smtpSecure: settings.secure,
      smtpUser: settings.user,
      smtpPasswordEncrypted: secretBox.encrypt(settings.password),
    },
  });
}

export async function createEtherealSender(userId: string, displayName?: string): Promise<SenderView> {
  let settings: SmtpSettings;
  try {
    settings = await createEtherealAccount();
  } catch (error) {
    throw AppError.serviceUnavailable("Could not create an Ethereal test account. Check your internet connection.", error);
  }
  const count = await prisma.sender.count({ where: { userId } });
  const sender = await saveEtherealSender(userId, displayName ?? `Ethereal Sender ${count + 1}`, settings);
  logger.info({ userId, senderId: sender.id }, "Ethereal sender created");
  return toSenderView(sender);
}

export async function ensureDefaultSender(userId: string): Promise<void> {
  if (!features.defaultEtherealSender || !env.ETHEREAL_USER || !env.ETHEREAL_PASSWORD) {
    return;
  }
  const count = await prisma.sender.count({ where: { userId } });
  if (count > 0) {
    return;
  }
  await saveEtherealSender(userId, "Ethereal (default)", {
    host: env.ETHEREAL_HOST,
    port: env.ETHEREAL_PORT,
    secure: env.ETHEREAL_PORT === 465,
    user: env.ETHEREAL_USER,
    password: env.ETHEREAL_PASSWORD,
  });
  logger.info({ userId }, "Default Ethereal sender created from environment");
}

export async function deleteSender(userId: string, senderId: string): Promise<void> {
  const sender = await getOwnedSender(userId, senderId);
  const campaigns = await prisma.campaign.count({ where: { senderId: sender.id } });
  if (campaigns > 0) {
    throw AppError.conflict("This sender has campaigns and cannot be deleted");
  }
  await prisma.sender.delete({ where: { id: sender.id } });
}

export async function sendTestEmail(
  userId: string,
  senderId: string,
  to: string,
): Promise<{ previewUrl: string | null; messageId: string }> {
  const sender = await getOwnedSender(userId, senderId);
  const text = `This is a test email from Outbox Scheduler.\n\nSender: ${sender.displayName} <${sender.email}>`;
  try {
    const result = await mailer.send(transportCacheKey(sender), smtpSettingsOf(sender), {
      messageId: `<test-${Date.now()}-${sender.id}@outbox.local>`,
      from: { name: sender.displayName, address: sender.email },
      to,
      subject: "Outbox Scheduler test email",
      text,
      html: textToHtml(text),
    });
    return { previewUrl: result.previewUrl, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof SmtpDeliveryError ? error.message : "SMTP send failed";
    throw AppError.badRequest(`Test email failed: ${message}`);
  }
}
