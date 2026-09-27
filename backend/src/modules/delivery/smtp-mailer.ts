import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface OutgoingMessage {
  messageId: string;
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
  response: string;
}

export type SmtpFailureKind = "permanent" | "transient";

export class SmtpDeliveryError extends Error {
  constructor(
    message: string,
    readonly kind: SmtpFailureKind,
    readonly code?: string,
    readonly responseCode?: number,
  ) {
    super(message);
    this.name = "SmtpDeliveryError";
  }
}

const PERMANENT_CODES = new Set(["EAUTH", "EENVELOPE", "EMESSAGE"]);

export function classifySmtpError(error: unknown): SmtpDeliveryError {
  if (error instanceof SmtpDeliveryError) {
    return error;
  }
  const source = (typeof error === "object" && error !== null ? error : {}) as {
    message?: unknown;
    code?: unknown;
    responseCode?: unknown;
  };
  const message = typeof source.message === "string" ? source.message : String(error);
  const code = typeof source.code === "string" ? source.code : undefined;
  const responseCode = typeof source.responseCode === "number" ? source.responseCode : undefined;

  let kind: SmtpFailureKind = "transient";
  if (responseCode !== undefined) {
    kind = responseCode >= 500 ? "permanent" : "transient";
  } else if (code && PERMANENT_CODES.has(code)) {
    kind = "permanent";
  }
  return new SmtpDeliveryError(message.slice(0, 500), kind, code, responseCode);
}

export class SmtpMailer {
  private readonly transports = new Map<string, Transporter<SMTPTransport.SentMessageInfo>>();

  constructor(private readonly timeoutMs: number) {}

  private createTransport(settings: SmtpSettings, pooled: boolean): Transporter<SMTPTransport.SentMessageInfo> {
    return nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      connectionTimeout: this.timeoutMs,
      greetingTimeout: this.timeoutMs,
      socketTimeout: this.timeoutMs,
      ...(pooled ? { pool: true, maxConnections: 2, maxMessages: 100 } : {}),
    });
  }

  private transportFor(cacheKey: string, settings: SmtpSettings): Transporter<SMTPTransport.SentMessageInfo> {
    let transport = this.transports.get(cacheKey);
    if (!transport) {
      for (const [key, stale] of this.transports) {
        if (key.startsWith(`${cacheKey.split("@")[0]}@`)) {
          stale.close();
          this.transports.delete(key);
        }
      }
      transport = this.createTransport(settings, true);
      this.transports.set(cacheKey, transport);
    }
    return transport;
  }

  async verify(settings: SmtpSettings): Promise<void> {
    const transport = this.createTransport(settings, false);
    try {
      await transport.verify();
    } catch (error) {
      throw classifySmtpError(error);
    } finally {
      transport.close();
    }
  }

  async send(cacheKey: string, settings: SmtpSettings, message: OutgoingMessage): Promise<SendResult> {
    const transport = this.transportFor(cacheKey, settings);
    let info: SMTPTransport.SentMessageInfo;
    try {
      info = await transport.sendMail({
        messageId: message.messageId,
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
    } catch (error) {
      throw classifySmtpError(error);
    }

    if (info.rejected.length > 0) {
      throw new SmtpDeliveryError(`Recipient rejected by SMTP server: ${info.response}`, "permanent");
    }
    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      messageId: info.messageId ?? message.messageId,
      previewUrl: typeof previewUrl === "string" ? previewUrl : null,
      response: info.response ?? "",
    };
  }

  closeAll(): void {
    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.transports.clear();
  }
}

export async function createEtherealAccount(): Promise<SmtpSettings> {
  const account = await nodemailer.createTestAccount();
  return {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    user: account.user,
    password: account.pass,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function textToHtml(text: string): string {
  return escapeHtml(text)
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? line : "&nbsp;"))
    .join("<br>");
}
