import { api } from "../lib/api-client";
import type {
  AppConfig,
  Campaign,
  CreateCampaignInput,
  CreateSmtpSenderInput,
  EmailDetail,
  EmailListItem,
  EmailStats,
  EmailStatus,
  EmailView,
  Page,
  ParsedRecipients,
  SearchResult,
  Sender,
  SlackStatus,
  User,
} from "../types/api";

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const authApi = {
  me: () => api<User>("/api/auth/me"),
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  googleLoginUrl: (returnTo: string) => `/api/auth/google${query({ returnTo })}`,
};

export const configApi = {
  get: () => api<AppConfig>("/api/config"),
};

export const emailsApi = {
  list: (params: { view: EmailView; page: number; pageSize: number; status?: EmailStatus }, signal?: AbortSignal) =>
    api<Page<EmailListItem>>(`/api/emails${query(params)}`, signal ? { signal } : {}),
  get: (emailId: string) => api<EmailDetail>(`/api/emails/${encodeURIComponent(emailId)}`),
  stats: () => api<EmailStats>("/api/emails/stats"),
};

export const searchApi = {
  emails: (params: { q: string; view: EmailView | "all"; page: number; pageSize: number }, signal?: AbortSignal) =>
    api<SearchResult>(`/api/search/emails${query(params)}`, signal ? { signal } : {}),
};

export const sendersApi = {
  list: () => api<Sender[]>("/api/senders"),
  createEthereal: (displayName?: string) =>
    api<Sender>("/api/senders/ethereal", { method: "POST", body: displayName ? { displayName } : {} }),
  createSmtp: (input: CreateSmtpSenderInput) => api<Sender>("/api/senders", { method: "POST", body: input }),
  test: (senderId: string) =>
    api<{ previewUrl: string | null; messageId: string }>(`/api/senders/${senderId}/test`, { method: "POST", body: {} }),
  remove: (senderId: string) => api<void>(`/api/senders/${senderId}`, { method: "DELETE" }),
};

export const leadsApi = {
  parseFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<ParsedRecipients>("/api/leads/parse", { method: "POST", body: form });
  },
  parseText: (text: string) => api<ParsedRecipients>("/api/leads/parse", { method: "POST", body: { text } }),
};

export const campaignsApi = {
  create: (input: CreateCampaignInput, idempotencyKey: string) =>
    api<Campaign>("/api/campaigns", { method: "POST", body: input, headers: { "Idempotency-Key": idempotencyKey } }),
};

export const slackApi = {
  status: () => api<SlackStatus>("/api/slack/status"),
  installUrl: "/api/slack/install",
  test: () => api<{ sent: boolean }>("/api/slack/test", { method: "POST", body: {} }),
  disconnect: () => api<void>("/api/slack/connection", { method: "DELETE" }),
};
