import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Plus, Send } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { RecipientPicker } from "../components/compose/RecipientPicker";
import { Button } from "../components/ui/Button";
import { SelectField, TextAreaField, TextField } from "../components/ui/Field";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { useConfig, useSenders } from "../hooks/queries";
import { ApiError, errorMessage } from "../lib/api-client";
import { formatDuration, formatFullDate, pluralize, toDateTimeLocal } from "../lib/format";
import { queryKeys } from "../lib/query-keys";
import { campaignsApi, sendersApi } from "../services/api";

type FieldName = "senderId" | "recipients" | "subject" | "body" | "delaySeconds" | "hourlyLimit" | "startAt";
type Errors = Partial<Record<FieldName, string>>;

interface Draft {
  senderId: string;
  recipients: string[];
  subject: string;
  body: string;
  delaySeconds: string;
  hourlyLimit: string;
  sendMode: "now" | "later";
  startAt: string;
}

const SERVER_FIELD_MAP: Record<string, FieldName> = {
  senderId: "senderId",
  recipients: "recipients",
  subject: "subject",
  body: "body",
  delayBetweenMs: "delaySeconds",
  hourlyLimit: "hourlyLimit",
  startAt: "startAt",
};

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function presetTime(kind: "15m" | "1h" | "tomorrow"): string {
  const date = new Date();
  if (kind === "15m") {
    date.setMinutes(date.getMinutes() + 15);
  } else if (kind === "1h") {
    date.setHours(date.getHours() + 1);
  } else {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return toDateTimeLocal(date);
}

const COMPACT_INPUT =
  "h-8 w-20 rounded-md border border-line bg-white px-2 text-sm text-ink focus:border-brand-500 focus:outline-none " +
  "focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-400";

export function validateDraft(draft: Draft, maxHourly: number): Errors {
  const errors: Errors = {};
  if (!draft.senderId) {
    errors.senderId = "Choose a sender";
  }
  if (draft.recipients.length === 0) {
    errors.recipients = "Upload a list with at least one valid email address";
  }
  if (draft.subject.trim().length === 0) {
    errors.subject = "Subject is required";
  } else if (draft.subject.length > 500) {
    errors.subject = "Subject must be 500 characters or fewer";
  }
  if (draft.body.trim().length === 0) {
    errors.body = "Write the email body";
  }
  const delay = Number(draft.delaySeconds);
  if (draft.delaySeconds.trim() === "" || !Number.isFinite(delay) || delay < 0 || delay > 86_400) {
    errors.delaySeconds = "Enter a delay between 0 and 86400 seconds";
  }
  const hourly = Number(draft.hourlyLimit);
  if (!Number.isInteger(hourly) || hourly < 1 || hourly > maxHourly) {
    errors.hourlyLimit = `Enter a whole number between 1 and ${maxHourly}`;
  }
  if (draft.sendMode === "later") {
    const start = new Date(draft.startAt).getTime();
    if (!draft.startAt || Number.isNaN(start)) {
      errors.startAt = "Pick a start date and time";
    } else if (start < Date.now() - 60_000) {
      errors.startAt = "Start time cannot be in the past";
    }
  }
  return errors;
}

export function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const config = useConfig();
  const senders = useSenders();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [errors, setErrors] = useState<Errors>({});
  const [draft, setDraft] = useState<Draft>({
    senderId: "",
    recipients: [],
    subject: "",
    body: "",
    delaySeconds: "2",
    hourlyLimit: "",
    sendMode: "now",
    startAt: presetTime("15m"),
  });

  const maxHourly = config.data?.limits.maxEmailsPerHourPerSender ?? 200;
  const minDelayMs = config.data?.limits.minSendDelayMs ?? 0;
  const windowMs = config.data?.limits.rateLimitWindowMs ?? 3_600_000;

  useEffect(() => {
    const first = senders.data?.[0];
    if (first && !draft.senderId) {
      setDraft((current) => ({ ...current, senderId: first.id }));
    }
  }, [senders.data, draft.senderId]);

  useEffect(() => {
    if (config.data && !draft.hourlyLimit) {
      setDraft((current) => ({ ...current, hourlyLimit: String(config.data.limits.maxEmailsPerHourPerSender) }));
    }
  }, [config.data, draft.hourlyLimit]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setIdempotencyKey(newIdempotencyKey());
    const fieldKey = key === "sendMode" ? "startAt" : key;
    if (fieldKey in errors) {
      setErrors((current) => ({ ...current, [fieldKey]: undefined }));
    }
  };

  const createEthereal = useMutation({
    mutationFn: () => sendersApi.createEthereal(),
    onSuccess: (sender) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.senders });
      update("senderId", sender.id);
      toast.success("Ethereal sender created", sender.email);
    },
    onError: (error) => toast.error("Could not create Ethereal sender", errorMessage(error)),
  });

  const schedule = useMutation({
    mutationFn: () => {
      const startAt = draft.sendMode === "now" ? new Date() : new Date(draft.startAt);
      return campaignsApi.create(
        {
          senderId: draft.senderId,
          subject: draft.subject.trim(),
          body: draft.body,
          recipients: draft.recipients,
          startAt: startAt.toISOString(),
          delayBetweenMs: Math.round(Number(draft.delaySeconds) * 1000),
          hourlyLimit: Number(draft.hourlyLimit),
        },
        idempotencyKey,
      );
    },
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emailsRoot });
      toast.success(
        `Scheduled ${pluralize(campaign.totalRecipients, "email")}`,
        `First email goes out ${formatFullDate(campaign.startAt)}`,
      );
      setIdempotencyKey(newIdempotencyKey());
      navigate("/scheduled");
    },
    onError: (error) => {
      if (error instanceof ApiError && Array.isArray(error.details)) {
        const fieldErrors: Errors = {};
        for (const detail of error.details as Array<{ path?: string; message?: string }>) {
          const field = SERVER_FIELD_MAP[(detail.path ?? "").split(".")[0] ?? ""];
          if (field && detail.message) {
            fieldErrors[field] = detail.message;
          }
        }
        setErrors(fieldErrors);
      }
      toast.error("Could not schedule emails", errorMessage(error));
    },
  });

  const estimate = useMemo(() => {
    const count = draft.recipients.length;
    if (count === 0) {
      return null;
    }
    const gapMs = Math.max(minDelayMs, Math.round(Number(draft.delaySeconds || "0") * 1000));
    const perWindow = Math.max(1, Math.min(Number(draft.hourlyLimit) || maxHourly, maxHourly));
    const windows = Math.ceil(count / perWindow);
    const pacingMs = (Math.min(count, perWindow) - 1) * gapMs;
    return { count, gapMs, perWindow, windows, pacingMs };
  }, [draft.recipients.length, draft.delaySeconds, draft.hourlyLimit, minDelayMs, maxHourly]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateDraft(draft, maxHourly);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    schedule.mutate();
  };

  const noSenders = senders.isSuccess && senders.data.length === 0;

  return (
    <form onSubmit={submit} noValidate className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3">
        <Link to="/scheduled" aria-label="Back to scheduled emails" className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink">
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 text-lg font-semibold">Compose New Email</h1>
        <div role="group" aria-label="When to send" className="flex items-center rounded-full border border-line p-0.5 text-sm">
          <button
            type="button"
            aria-pressed={draft.sendMode === "now"}
            onClick={() => update("sendMode", "now")}
            className={`rounded-full px-3 py-1 font-medium ${draft.sendMode === "now" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
          >
            Now
          </button>
          <button
            type="button"
            aria-pressed={draft.sendMode === "later"}
            onClick={() => update("sendMode", "later")}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ${draft.sendMode === "later" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
          >
            <CalendarClock aria-hidden="true" className="h-4 w-4" />
            Later
          </button>
        </div>
        <Button
          type="submit"
          variant="outline"
          className="rounded-full!"
          loading={schedule.isPending}
          icon={<Send aria-hidden="true" className="h-4 w-4" />}
        >
          {draft.sendMode === "now" ? "Send" : "Send later"}
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-2 pb-6">
        <div className="flex items-center gap-3 border-b border-line py-3">
          {senders.isPending ? (
            <Spinner label="Loading senders" />
          ) : noSenders ? (
            <div className="flex flex-1 items-center gap-3 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
              You have no senders yet.
              <Button size="sm" variant="outline" loading={createEthereal.isPending} onClick={() => createEthereal.mutate()} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>
                Create Ethereal sender
              </Button>
            </div>
          ) : (
            <>
              <SelectField
                label="From"
                inline
                wrapperClassName="flex-1"
                className="h-9 border-transparent! px-1!"
                value={draft.senderId}
                error={errors.senderId}
                onChange={(event) => update("senderId", event.target.value)}
              >
                {senders.data?.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.displayName} &lt;{sender.email}&gt;
                  </option>
                ))}
              </SelectField>
              <Button variant="ghost" size="sm" loading={createEthereal.isPending} onClick={() => createEthereal.mutate()} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>
                Ethereal sender
              </Button>
            </>
          )}
        </div>

        <div className="border-b border-line py-3">
          <RecipientPicker
            recipients={draft.recipients}
            maxUploadBytes={config.data?.limits.uploadMaxBytes ?? 5 * 1024 * 1024}
            error={errors.recipients}
            onChange={(recipients) => update("recipients", recipients)}
          />
        </div>

        <TextField
          label="Subject"
          inline
          wrapperClassName="border-b border-line py-3"
          className="h-9 border-transparent! px-1!"
          value={draft.subject}
          maxLength={500}
          placeholder="Subject"
          error={errors.subject}
          onChange={(event) => update("subject", event.target.value)}
        />

        {draft.sendMode === "later" ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line py-3">
            <TextField
              label="Send at"
              inline
              type="datetime-local"
              wrapperClassName="w-80"
              className="h-9"
              value={draft.startAt}
              min={toDateTimeLocal(new Date())}
              error={errors.startAt}
              onChange={(event) => update("startAt", event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" className="h-7! rounded-full!" onClick={() => update("startAt", presetTime("15m"))}>
                In 15 min
              </Button>
              <Button size="sm" variant="secondary" className="h-7! rounded-full!" onClick={() => update("startAt", presetTime("1h"))}>
                In 1 hour
              </Button>
              <Button size="sm" variant="secondary" className="h-7! rounded-full!" onClick={() => update("startAt", presetTime("tomorrow"))}>
                Tomorrow 9 AM
              </Button>
            </div>
          </div>
        ) : null}

        <div className="border-b border-line py-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <label className="flex items-center gap-2 text-muted">
              Delay between 2 emails
              <input
                type="number"
                min={0}
                max={86400}
                step="0.5"
                inputMode="decimal"
                value={draft.delaySeconds}
                aria-invalid={errors.delaySeconds ? true : undefined}
                aria-describedby="compose-limits-hint"
                onChange={(event) => update("delaySeconds", event.target.value)}
                className={COMPACT_INPUT}
              />
              sec
            </label>
            <label className="flex items-center gap-2 text-muted">
              Hourly limit
              <input
                type="number"
                min={1}
                max={maxHourly}
                step={1}
                inputMode="numeric"
                value={draft.hourlyLimit}
                aria-invalid={errors.hourlyLimit ? true : undefined}
                aria-describedby="compose-limits-hint"
                onChange={(event) => update("hourlyLimit", event.target.value)}
                className={COMPACT_INPUT}
              />
            </label>
          </div>
          <p id="compose-limits-hint" className="mt-1.5 text-xs text-muted">
            {minDelayMs > 0 ? `The server keeps at least ${minDelayMs / 1000}s between sends per sender. ` : ""}
            Hourly limit can be up to {maxHourly} per sender per {formatDuration(windowMs)}.
          </p>
          {errors.delaySeconds ? (
            <p role="alert" className="mt-1 text-xs font-medium text-red-600">
              {errors.delaySeconds}
            </p>
          ) : null}
          {errors.hourlyLimit ? (
            <p role="alert" className="mt-1 text-xs font-medium text-red-600">
              {errors.hourlyLimit}
            </p>
          ) : null}
        </div>

        <TextAreaField
          label="Body"
          wrapperClassName="pt-4"
          rows={12}
          value={draft.body}
          placeholder="Type your email..."
          error={errors.body}
          onChange={(event) => update("body", event.target.value)}
        />

        {estimate ? (
          <p className="pt-3 text-xs text-muted" aria-live="polite">
            {pluralize(estimate.count, "email")} will be sent about {formatDuration(estimate.gapMs)} apart, up to{" "}
            {estimate.perWindow.toLocaleString()} per {formatDuration(windowMs)}.
            {estimate.windows > 1
              ? ` This needs about ${estimate.windows} windows. Emails over the limit wait for the next window instead of being dropped.`
              : ` The batch should finish in roughly ${formatDuration(Math.max(estimate.pacingMs, 1000))}.`}
          </p>
        ) : null}
      </div>
    </form>
  );
}
