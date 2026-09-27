import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { formatFullDate, formatListTime } from "../../lib/format";
import type { EmailStatus, EmailView } from "../../types/api";
import { Highlight } from "./Highlight";
import { StatusBadge, statusLabel } from "./StatusBadge";

export interface EmailRowData {
  id: string;
  recipientEmail: string;
  subject: string;
  snippet: string;
  status: EmailStatus;
  nextAttemptAt: string;
  completedAt: string | null;
  lastError: string | null;
  previewUrl: string | null;
  highlights?: { subject?: string[]; body?: string[]; recipientEmail?: string[] } | undefined;
}

export function rowTime(email: EmailRowData, view: EmailView): string | null {
  if (view === "sent" || email.status === "sent" || email.status === "failed") {
    return email.completedAt;
  }
  return email.nextAttemptAt;
}

export function EmailRow({ email, view }: { email: EmailRowData; view: EmailView }) {
  const time = rowTime(email, view);
  const subject = email.highlights?.subject?.[0];
  const snippet = email.highlights?.body?.[0];
  const recipient = email.highlights?.recipientEmail?.[0];

  return (
    <li className="flex items-center transition-colors hover:bg-canvas">
      <Link
        to={`/emails/${email.id}`}
        className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-6 focus-visible:bg-canvas focus-visible:outline-none"
      >
        <span className="w-56 shrink-0 truncate text-sm font-semibold text-ink">
          <span className="font-normal text-muted">To: </span>
          {recipient ? <Highlight text={recipient} /> : email.recipientEmail}
        </span>
        <span title={`${statusLabel(email.status)} · ${formatFullDate(time)}`}>
          <StatusBadge status={email.status} time={time ? formatListTime(time) : undefined} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-ink">{subject ? <Highlight text={subject} /> : email.subject}</span>
          <span className="text-muted"> - {snippet ? <Highlight text={snippet} /> : email.snippet}</span>
          {email.status === "failed" && email.lastError ? (
            <span className="ml-2 text-xs text-red-600">({email.lastError})</span>
          ) : null}
        </span>
      </Link>
      <span className="flex w-28 shrink-0 justify-end pr-6">
        {email.previewUrl ? (
          <a
            href={email.previewUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open Ethereal preview of the email to ${email.recipientEmail}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            Preview
          </a>
        ) : null}
      </span>
    </li>
  );
}
