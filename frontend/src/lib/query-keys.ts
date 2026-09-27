import type { EmailView } from "../types/api";

export const queryKeys = {
  me: ["me"] as const,
  config: ["config"] as const,
  stats: ["emails", "stats"] as const,
  emails: (view: EmailView, page: number) => ["emails", "list", view, page] as const,
  emailsRoot: ["emails"] as const,
  email: (emailId: string) => ["emails", "detail", emailId] as const,
  search: (q: string, view: EmailView, page: number) => ["search", q, view, page] as const,
  senders: ["senders"] as const,
  slack: ["slack"] as const,
};
