import { ArrowLeft, ExternalLink } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { StatusBadge } from "../components/email/StatusBadge";
import { Avatar } from "../components/ui/Avatar";
import { buttonClasses } from "../components/ui/Button";
import { ErrorState } from "../components/ui/States";
import { Spinner } from "../components/ui/Spinner";
import { useEmail } from "../hooks/queries";
import { formatFullDate, formatRelative } from "../lib/format";

const EVENT_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  attempt_started: "Delivery attempt started",
  rate_limited: "Hourly limit reached, rescheduled",
  retry_scheduled: "Temporary failure, retry scheduled",
  sent: "Sent",
  failed: "Failed",
};

export function EmailDetailPage() {
  const { emailId = "" } = useParams();
  const navigate = useNavigate();
  const email = useEmail(emailId);

  if (email.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-brand-600">
        <Spinner size="lg" label="Loading email" />
      </div>
    );
  }
  if (email.isError) {
    return <ErrorState error={email.error} title="Could not load this email" onRetry={() => void email.refetch()} />;
  }

  const data = email.data;
  const finished = data.status === "sent" || data.status === "failed";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(finished ? "/sent" : "/scheduled"))}
          aria-label="Back"
          className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{data.subject}</h1>
        <StatusBadge status={data.status} />
      </header>

      <div className="grid gap-8 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <article className="min-w-0">
          <div className="flex items-start gap-3">
            <Avatar name={data.sender.displayName} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {data.sender.displayName} <span className="font-normal text-muted">&lt;{data.sender.email}&gt;</span>
              </p>
              <p className="text-sm text-muted">To: {data.recipientEmail}</p>
            </div>
            <p className="text-right text-xs text-muted">
              {finished ? formatFullDate(data.completedAt) : formatFullDate(data.nextAttemptAt)}
            </p>
          </div>
          <div className="mt-6 whitespace-pre-wrap rounded-xl border border-line bg-canvas p-5 text-sm leading-6 text-ink">
            {data.body}
          </div>
          {data.previewUrl ? (
            <a href={data.previewUrl} target="_blank" rel="noreferrer" className={buttonClasses("outline", "md", "mt-4")}>
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              Open Ethereal preview
            </a>
          ) : null}
          {data.lastError ? (
            <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Last error: {data.lastError}
            </p>
          ) : null}
        </article>

        <aside className="flex flex-col gap-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-line p-4 text-sm">
            <dt className="text-muted">Planned</dt>
            <dd>{formatFullDate(data.scheduledAt)}</dd>
            {!finished ? (
              <>
                <dt className="text-muted">Next attempt</dt>
                <dd>
                  {formatFullDate(data.nextAttemptAt)}{" "}
                  <span className="text-muted">({formatRelative(data.nextAttemptAt)})</span>
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted">{data.status === "sent" ? "Sent" : "Failed"}</dt>
                <dd>{formatFullDate(data.completedAt)}</dd>
              </>
            )}
            <dt className="text-muted">Attempts</dt>
            <dd>{data.attempts}</dd>
            {data.messageId ? (
              <>
                <dt className="text-muted">Message ID</dt>
                <dd className="truncate font-mono text-xs" title={data.messageId}>
                  {data.messageId}
                </dd>
              </>
            ) : null}
          </dl>

          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="mb-3 text-sm font-semibold">
              History
            </h2>
            <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
              {data.events.map((event) => (
                <li key={event.id} className="relative">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                  <p className="text-sm font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
                  {event.message ? <p className="text-xs break-words text-muted">{event.message}</p> : null}
                  <p className="text-xs text-muted">{formatFullDate(event.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>

          <Link to={`/${finished ? "sent" : "scheduled"}`} className="text-sm font-medium text-brand-700 hover:underline">
            Back to {finished ? "Sent" : "Scheduled"}
          </Link>
        </aside>
      </div>
    </div>
  );
}
