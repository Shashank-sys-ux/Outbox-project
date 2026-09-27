CREATE TYPE "email_status" AS ENUM ('scheduled', 'processing', 'rate_limited', 'sent', 'failed');

CREATE TYPE "email_event_type" AS ENUM ('scheduled', 'attempt_started', 'rate_limited', 'retry_scheduled', 'sent', 'failed');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "google_sub" VARCHAR(255) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "avatar_url" TEXT,
    "last_login_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "senders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "smtp_host" VARCHAR(255) NOT NULL,
    "smtp_port" INTEGER NOT NULL,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "smtp_user" VARCHAR(254) NOT NULL,
    "smtp_password_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "senders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "delay_between_ms" INTEGER NOT NULL,
    "hourly_limit" INTEGER NOT NULL,
    "total_recipients" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emails" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_email" VARCHAR(254) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "email_status" NOT NULL DEFAULT 'scheduled',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "message_id" VARCHAR(255),
    "preview_url" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "type" "email_event_type" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slack_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" VARCHAR(50) NOT NULL,
    "team_name" VARCHAR(200) NOT NULL,
    "channel_id" VARCHAR(50) NOT NULL,
    "channel_name" VARCHAR(200) NOT NULL,
    "scope" VARCHAR(500) NOT NULL,
    "webhook_url_encrypted" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

CREATE UNIQUE INDEX "senders_user_id_email_key" ON "senders"("user_id", "email");

CREATE INDEX "campaigns_user_id_created_at_idx" ON "campaigns"("user_id", "created_at" DESC);

CREATE UNIQUE INDEX "campaigns_user_id_idempotency_key_key" ON "campaigns"("user_id", "idempotency_key");

CREATE INDEX "emails_user_id_status_next_attempt_at_idx" ON "emails"("user_id", "status", "next_attempt_at");

CREATE INDEX "emails_user_id_status_completed_at_idx" ON "emails"("user_id", "status", "completed_at" DESC);

CREATE INDEX "emails_status_next_attempt_at_idx" ON "emails"("status", "next_attempt_at");

CREATE UNIQUE INDEX "emails_campaign_id_recipient_email_key" ON "emails"("campaign_id", "recipient_email");

CREATE INDEX "email_events_email_id_created_at_idx" ON "email_events"("email_id", "created_at");

CREATE UNIQUE INDEX "slack_connections_user_id_key" ON "slack_connections"("user_id");

ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "senders"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "emails" ADD CONSTRAINT "emails_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "senders"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
