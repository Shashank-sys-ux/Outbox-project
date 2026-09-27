export type EmailStatus = "scheduled" | "processing" | "rate_limited" | "sent" | "failed";
export type EmailView = "scheduled" | "sent";

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface AppConfig {
  googleAuth: boolean;
  slack: boolean;
  limits: {
    minSendDelayMs: number;
    maxEmailsPerHourPerSender: number;
    rateLimitWindowMs: number;
    maxRecipientsPerCampaign: number;
    uploadMaxBytes: number;
  };
}

export interface SenderRef {
  id: string;
  email: string;
  displayName: string;
}

export interface Sender extends SenderRef {
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

export interface EmailListItem {
  id: string;
  campaignId: string;
  recipientEmail: string;
  subject: string;
  snippet: string;
  status: EmailStatus;
  scheduledAt: string;
  nextAttemptAt: string;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  previewUrl: string | null;
  sender: SenderRef;
}

export interface EmailEvent {
  id: string;
  type: string;
  message: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface EmailDetail extends EmailListItem {
  body: string;
  messageId: string | null;
  events: EmailEvent[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmailStats {
  scheduled: number;
  sent: number;
  byStatus: Record<EmailStatus, number>;
}

export interface SearchHit {
  id: string;
  campaignId: string;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  snippet: string;
  status: EmailStatus;
  attempts: number;
  scheduledAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  completedAt: string | null;
  previewUrl: string | null;
  lastError: string | null;
  createdAt: string;
  highlights: { subject?: string[]; body?: string[]; recipientEmail?: string[] };
  score: number | null;
}

export interface SearchResult extends Page<SearchHit> {
  tookMs: number;
  source: "elasticsearch";
}

export interface ParseStats {
  candidates: number;
  valid: number;
  invalid: number;
  duplicates: number;
  truncated: number;
}

export interface ParsedRecipients {
  emails: string[];
  invalidSamples: string[];
  stats: ParseStats;
  maxRecipients: number;
}

export interface CreateCampaignInput {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface Campaign {
  id: string;
  subject: string;
  sender: SenderRef;
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
  totalRecipients: number;
  createdAt: string;
  counts: Record<EmailStatus, number>;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
  connectedAt: string | null;
}
