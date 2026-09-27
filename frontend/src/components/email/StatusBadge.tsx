import { AlertCircle, CheckCircle2, Clock, Gauge, Loader2 } from "lucide-react";
import type { EmailStatus } from "../../types/api";

const STYLES: Record<EmailStatus, { label: string; className: string; Icon: typeof Clock }> = {
  scheduled: { label: "Scheduled", className: "bg-orange-50 text-orange-700 border-orange-200", Icon: Clock },
  processing: { label: "Sending", className: "bg-blue-50 text-blue-700 border-blue-200", Icon: Loader2 },
  rate_limited: { label: "Rate limited", className: "bg-amber-50 text-amber-800 border-amber-200", Icon: Gauge },
  sent: { label: "Sent", className: "bg-brand-50 text-brand-700 border-brand-200", Icon: CheckCircle2 },
  failed: { label: "Failed", className: "bg-red-50 text-red-700 border-red-200", Icon: AlertCircle },
};

export function statusLabel(status: EmailStatus): string {
  return STYLES[status].label;
}

export function StatusBadge({ status, time }: { status: EmailStatus; time?: string }) {
  const { label, className, Icon } = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${status === "processing" ? "animate-spin" : ""}`} />
      {time ? <span>{time}</span> : null}
      <span className={time ? "sr-only" : ""}>{label}</span>
    </span>
  );
}
