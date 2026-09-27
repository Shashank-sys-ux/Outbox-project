import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const emailList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: integer(1, 65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    APP_URL: z.url({ protocol: /^https?$/ }).default("https://localhost:5173"),
    TRUST_PROXY: integer(0, 10).default(0),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: integer(1, 100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    ELASTICSEARCH_URL: z.url({ protocol: /^https?$/ }),
    ELASTICSEARCH_INDEX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
      .default("outbox-emails"),
    SHUTDOWN_TIMEOUT_MS: integer(1000, 60000).default(10000),

    SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
    SESSION_TTL_SECONDS: integer(300, 60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),
    COOKIE_SECURE: booleanFlag.default(true),
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64")
      .refine((value) => Buffer.from(value, "base64").length === 32, "must decode to exactly 32 bytes"),

    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z.url({ protocol: /^https?$/ }).optional(),

    SLACK_CLIENT_ID: z.string().min(1).optional(),
    SLACK_CLIENT_SECRET: z.string().min(1).optional(),
    SLACK_REDIRECT_URI: z.url({ protocol: /^https$/ }).optional(),

    ETHEREAL_HOST: z.string().min(1).default("smtp.ethereal.email"),
    ETHEREAL_PORT: integer(1, 65535).default(587),
    ETHEREAL_USER: z.string().min(1).optional(),
    ETHEREAL_PASSWORD: z.string().min(1).optional(),

    ADMIN_EMAILS: emailList.default([]),
    BULL_BOARD_READ_ONLY: booleanFlag.default(false),

    WORKER_CONCURRENCY: integer(1, 100).default(5),
    MIN_SEND_DELAY_MS: integer(0, 3_600_000).default(2000),
    MAX_EMAILS_PER_HOUR_PER_SENDER: integer(1, 100_000).default(200),
    RATE_LIMIT_WINDOW_MS: integer(60_000, 86_400_000).default(3_600_000),
    EMAIL_MAX_ATTEMPTS: integer(1, 20).default(5),
    EMAIL_RETRY_BACKOFF_MS: integer(1000, 3_600_000).default(30_000),
    EMAIL_LOCK_DURATION_MS: integer(5000, 600_000).default(30_000),
    SMTP_TIMEOUT_MS: integer(1000, 120_000).default(20_000),

    UPLOAD_MAX_BYTES: integer(1024, 50 * 1024 * 1024).default(5 * 1024 * 1024),
    MAX_RECIPIENTS_PER_CAMPAIGN: integer(1, 100_000).default(10_000),
    API_RATE_LIMIT_PER_MINUTE: integer(10, 100_000).default(300),
    AUTH_RATE_LIMIT_PER_MINUTE: integer(5, 10_000).default(30),
  })
  .superRefine((value, context) => {
    const groups: Array<[string, Array<keyof typeof value>]> = [
      ["Google OAuth", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
      ["Slack OAuth", ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"]],
      ["Ethereal credentials", ["ETHEREAL_USER", "ETHEREAL_PASSWORD"]],
    ];
    for (const [label, keys] of groups) {
      const present = keys.filter((key) => value[key] !== undefined);
      if (present.length > 0 && present.length < keys.length) {
        for (const key of keys.filter((candidate) => value[candidate] === undefined)) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${label} is partially configured: set ${keys.join(" and ")} together`,
          });
        }
      }
    }
    const slackRedirect = value.SLACK_REDIRECT_URI ?? `${new URL(value.APP_URL).origin}/api/slack/callback`;
    if (value.SLACK_CLIENT_ID && !slackRedirect.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["SLACK_REDIRECT_URI"],
        message: "Slack requires an https redirect URI, set SLACK_REDIRECT_URI or use an https APP_URL",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const nonEmpty = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(nonEmpty);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function loadEnv(): Env {
  const envFilePath = fileURLToPath(new URL("../../.env", import.meta.url));
  if (process.env.NODE_ENV !== "test" && existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }

  try {
    return parseEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const env = loadEnv();

export const appOrigin = new URL(env.APP_URL).origin;

export const oauthRedirects = {
  google: env.GOOGLE_CALLBACK_URL ?? `${appOrigin}/api/auth/google/callback`,
  slack: env.SLACK_REDIRECT_URI ?? `${appOrigin}/api/slack/callback`,
};

export const features = {
  googleAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  slack: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
  defaultEtherealSender: Boolean(env.ETHEREAL_USER && env.ETHEREAL_PASSWORD),
};
