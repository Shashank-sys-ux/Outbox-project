import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Mail, MessageSquare, Plus, Send, Trash2, Unplug } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Button, buttonClasses } from "../components/ui/Button";
import { TextField } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { ErrorState } from "../components/ui/States";
import { Spinner } from "../components/ui/Spinner";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useSenders, useSlackStatus } from "../hooks/queries";
import { errorMessage } from "../lib/api-client";
import { formatFullDate } from "../lib/format";
import { queryKeys } from "../lib/query-keys";
import { sendersApi, slackApi } from "../services/api";
import type { CreateSmtpSenderInput } from "../types/api";

const SLACK_RESULTS: Record<string, { kind: "success" | "error" | "info"; message: string }> = {
  connected: { kind: "success", message: "Slack connected. Rate limit alerts will be posted to your channel." },
  denied: { kind: "info", message: "Slack authorization was cancelled." },
  error: { kind: "error", message: "Slack connection failed. Please try again." },
  not_configured: { kind: "error", message: "Slack is not configured on the server." },
};

function Card({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </h2>
        {action}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

const EMPTY_SMTP: CreateSmtpSenderInput = {
  displayName: "",
  email: "",
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
};

function SendersCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const senders = useSenders();
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [smtp, setSmtp] = useState<CreateSmtpSenderInput>(EMPTY_SMTP);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.senders });

  const createEthereal = useMutation({
    mutationFn: () => sendersApi.createEthereal(),
    onSuccess: (sender) => {
      refresh();
      toast.success("Ethereal sender created", sender.email);
    },
    onError: (error) => toast.error("Could not create Ethereal sender", errorMessage(error)),
  });

  const createSmtp = useMutation({
    mutationFn: (input: CreateSmtpSenderInput) => sendersApi.createSmtp(input),
    onSuccess: (sender) => {
      refresh();
      setSmtpOpen(false);
      setSmtp(EMPTY_SMTP);
      toast.success("SMTP sender verified and saved", sender.email);
    },
    onError: (error) => toast.error("Could not add SMTP sender", errorMessage(error)),
  });

  const test = useMutation({
    mutationFn: (senderId: string) => sendersApi.test(senderId),
    onSuccess: (result) =>
      toast.success(
        "Test email sent",
        "It was delivered to your own address.",
        result.previewUrl ? { label: "Open Ethereal preview", href: result.previewUrl } : undefined,
      ),
    onError: (error) => toast.error("Test email failed", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (senderId: string) => sendersApi.remove(senderId),
    onSuccess: () => {
      refresh();
      toast.info("Sender removed");
    },
    onError: (error) => toast.error("Could not remove sender", errorMessage(error)),
  });

  const submitSmtp = (event: FormEvent) => {
    event.preventDefault();
    createSmtp.mutate({ ...smtp, smtpPort: Number(smtp.smtpPort) });
  };

  return (
    <Card
      title="Senders"
      icon={<Mail aria-hidden="true" className="h-5 w-5 text-brand-600" />}
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSmtpOpen(true)}>
            Add SMTP
          </Button>
          <Button size="sm" loading={createEthereal.isPending} onClick={() => createEthereal.mutate()} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>
            Ethereal sender
          </Button>
        </div>
      }
    >
      {senders.isPending ? (
        <Spinner label="Loading senders" />
      ) : senders.isError ? (
        <ErrorState error={senders.error} onRetry={() => void senders.refetch()} />
      ) : senders.data.length === 0 ? (
        <p className="text-sm text-muted">No senders yet. Create a free Ethereal test sender to start scheduling.</p>
      ) : (
        <ul className="divide-y divide-line">
          {senders.data.map((sender) => (
            <li key={sender.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {sender.displayName}
                  {sender.isEthereal ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Ethereal</span> : null}
                </p>
                <p className="truncate text-xs text-muted">
                  {sender.email} · {sender.smtpHost}:{sender.smtpPort}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={test.isPending && test.variables === sender.id}
                onClick={() => test.mutate(sender.id)}
                icon={<Send aria-hidden="true" className="h-4 w-4" />}
              >
                Send test
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Remove ${sender.email}`}
                loading={remove.isPending && remove.variables === sender.id}
                onClick={() => remove.mutate(sender.id)}
                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={smtpOpen}
        title="Add SMTP sender"
        onClose={() => setSmtpOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSmtpOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="smtp-form" loading={createSmtp.isPending}>
              Verify and save
            </Button>
          </>
        }
      >
        <form id="smtp-form" onSubmit={submitSmtp} className="grid gap-4 sm:grid-cols-2">
          <TextField label="Display name" required value={smtp.displayName} onChange={(event) => setSmtp({ ...smtp, displayName: event.target.value })} />
          <TextField label="From email" type="email" required value={smtp.email} onChange={(event) => setSmtp({ ...smtp, email: event.target.value })} />
          <TextField label="SMTP host" required value={smtp.smtpHost} onChange={(event) => setSmtp({ ...smtp, smtpHost: event.target.value })} />
          <TextField label="Port" type="number" required value={smtp.smtpPort} onChange={(event) => setSmtp({ ...smtp, smtpPort: Number(event.target.value) })} />
          <TextField label="Username" required value={smtp.smtpUser} onChange={(event) => setSmtp({ ...smtp, smtpUser: event.target.value })} />
          <TextField
            label="Password"
            type="password"
            required
            autoComplete="new-password"
            value={smtp.smtpPassword}
            onChange={(event) => setSmtp({ ...smtp, smtpPassword: event.target.value })}
          />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={smtp.smtpSecure} onChange={(event) => setSmtp({ ...smtp, smtpSecure: event.target.checked })} className="accent-brand-600" />
            Use TLS from the start (usually port 465)
          </label>
          <p className="text-xs text-muted sm:col-span-2">The password is encrypted with AES-256-GCM before it is stored.</p>
        </form>
      </Modal>
    </Card>
  );
}

function SlackCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const slack = useSlackStatus();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.slack });

  const test = useMutation({
    mutationFn: slackApi.test,
    onSuccess: () => toast.success("Test message posted to Slack"),
    onError: (error) => toast.error("Slack test failed", errorMessage(error)),
  });

  const disconnect = useMutation({
    mutationFn: slackApi.disconnect,
    onSuccess: () => {
      refresh();
      toast.info("Slack disconnected");
    },
    onError: (error) => toast.error("Could not disconnect Slack", errorMessage(error)),
  });

  return (
    <Card title="Slack alerts" icon={<MessageSquare aria-hidden="true" className="h-5 w-5 text-brand-600" />}>
      {slack.isPending ? (
        <Spinner label="Checking Slack" />
      ) : slack.isError ? (
        <ErrorState error={slack.error} onRetry={() => void slack.refetch()} />
      ) : !slack.data.configured ? (
        <p className="text-sm text-muted">
          Slack OAuth is not configured on the server. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_REDIRECT_URI in backend/.env.
        </p>
      ) : slack.data.connected ? (
        <div className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-sm">
            Connected to <strong>{slack.data.teamName}</strong> in <strong>{slack.data.channelName}</strong>
            <span className="block text-xs text-muted">Since {formatFullDate(slack.data.connectedAt)}</span>
          </p>
          <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            Send test
          </Button>
          <a href={slackApi.installUrl} className={buttonClasses("secondary", "sm")}>
            Reconnect
          </a>
          <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()} icon={<Unplug aria-hidden="true" className="h-4 w-4" />}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-sm text-muted">
            Get a Slack message when a sender reaches its hourly limit. You will pick a channel on Slack.
          </p>
          <a href={slackApi.installUrl} className={buttonClasses("primary", "md")}>
            Connect Slack
          </a>
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const slackResult = params.get("slack");

  useEffect(() => {
    if (!slackResult) {
      return;
    }
    const result = SLACK_RESULTS[slackResult];
    if (result) {
      toast.show({ variant: result.kind, title: result.message });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    setParams({}, { replace: true });
  }, [slackResult, toast, queryClient, setParams]);

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-line px-6 py-4">
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
        <SendersCard />
        <SlackCard />
        {user?.isAdmin ? (
          <Card title="Queue dashboard" icon={<LayoutDashboard aria-hidden="true" className="h-5 w-5 text-brand-600" />}>
            <div className="flex flex-wrap items-center gap-4">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Live view of waiting, delayed, active, completed and failed BullMQ jobs. Only emails listed in ADMIN_EMAILS can open it.
              </p>
              <a href="/admin/queues" target="_blank" rel="noreferrer" className={buttonClasses("secondary", "md")}>
                Open Bull Board
              </a>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
