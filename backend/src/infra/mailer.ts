import { env } from "../config/env.js";
import { SmtpMailer } from "../modules/delivery/smtp-mailer.js";

export const mailer = new SmtpMailer(env.SMTP_TIMEOUT_MS);
