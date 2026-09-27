export const QUEUE_NAMES = {
  emailSend: "email-send",
  searchIndex: "search-index",
  notifications: "notifications",
} as const;

export const JOB_NAMES = {
  sendEmail: "send-email",
  indexEmail: "index-email",
  rateLimitAlert: "rate-limit-alert",
} as const;

export interface SlotReservation {
  slot: number;
}

export interface SendEmailJobData {
  emailId: string;
  reservation?: SlotReservation;
}

export interface SearchIndexJobData {
  emailId: string;
}

export interface RateLimitAlertJobData {
  userId: string;
  senderId: string;
  senderEmail: string;
  scope: "sender" | "campaign";
  campaignId: string;
  campaignSubject: string;
  limit: number;
  windowStart: number;
  windowEnd: number;
  retryAt: number;
}
