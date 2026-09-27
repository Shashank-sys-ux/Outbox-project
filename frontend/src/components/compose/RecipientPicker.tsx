import { useMutation } from "@tanstack/react-query";
import { ClipboardList, FileUp, Users, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { errorMessage } from "../../lib/api-client";
import { pluralize } from "../../lib/format";
import { leadsApi } from "../../services/api";
import type { ParsedRecipients } from "../../types/api";
import { Button } from "../ui/Button";

interface RecipientPickerProps {
  recipients: string[];
  maxUploadBytes: number;
  error?: string | undefined;
  onChange: (recipients: string[], summary: ParsedRecipients | null) => void;
}

const PREVIEW_COUNT = 6;

export function RecipientPicker({ recipients, maxUploadBytes, error, onChange }: RecipientPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const [summary, setSummary] = useState<ParsedRecipients | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = (result: ParsedRecipients, from: string) => {
    setSummary(result);
    setSource(from);
    setLocalError(null);
    onChange(result.emails, result);
  };

  const upload = useMutation({
    mutationFn: (file: File) => leadsApi.parseFile(file),
    onSuccess: (result, file) => accept(result, file.name),
    onError: (uploadError) => setLocalError(errorMessage(uploadError)),
  });

  const paste = useMutation({
    mutationFn: (text: string) => leadsApi.parseText(text),
    onSuccess: (result) => {
      accept(result, "pasted list");
      setPasteOpen(false);
    },
    onError: (pasteError) => setLocalError(errorMessage(pasteError)),
  });

  const handleFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setLocalError("Please choose a .csv or .txt file");
      return;
    }
    if (file.size === 0) {
      setLocalError("The selected file is empty");
      return;
    }
    if (file.size > maxUploadBytes) {
      setLocalError(`The file is larger than ${(maxUploadBytes / 1024 / 1024).toFixed(0)} MB`);
      return;
    }
    upload.mutate(file);
  };

  const clear = () => {
    setSummary(null);
    setSource(null);
    onChange([], null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const busy = upload.isPending || paste.isPending;
  const shownError = localError ?? error;

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <div className="flex items-start gap-3">
        <span id={labelId} className="w-20 shrink-0 pt-2 text-sm font-medium text-muted">
          To
        </span>
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {recipients.slice(0, PREVIEW_COUNT).map((email) => (
            <span key={email} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700">
              {email}
            </span>
          ))}
          {recipients.length > PREVIEW_COUNT ? (
            <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">
              +{(recipients.length - PREVIEW_COUNT).toLocaleString()} more
            </span>
          ) : null}
          {recipients.length === 0 ? <span className="text-sm text-muted/80">Upload a CSV or text file with email addresses</span> : null}
          <span className="ml-auto flex items-center gap-1">
            {recipients.length > 0 ? (
              <button type="button" onClick={clear} className="rounded p-1 text-muted hover:text-ink" aria-label="Clear recipients">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-brand-700"
              loading={upload.isPending}
              disabled={busy}
              icon={<FileUp aria-hidden="true" className="h-4 w-4" />}
              onClick={() => inputRef.current?.click()}
            >
              Upload List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              icon={<ClipboardList aria-hidden="true" className="h-4 w-4" />}
              onClick={() => setPasteOpen((open) => !open)}
              aria-expanded={pasteOpen}
            >
              Paste
            </Button>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload recipient list"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </div>
      </div>

      {pasteOpen ? (
        <div className="ml-23 flex flex-col gap-2">
          <label className="sr-only" htmlFor={`${labelId}-paste`}>
            Paste email addresses
          </label>
          <textarea
            id={`${labelId}-paste`}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={4}
            placeholder="Paste addresses separated by commas, spaces or new lines"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={paste.isPending} disabled={pasteText.trim().length === 0} onClick={() => paste.mutate(pasteText)}>
              Detect emails
            </Button>
          </div>
        </div>
      ) : null}

      {summary ? (
        <p className="ml-23 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
          <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
            <Users aria-hidden="true" className="h-4 w-4" />
            Detected {pluralize(summary.stats.valid, "email address", "email addresses")}
          </span>
          {source ? <span className="text-muted">from {source}</span> : null}
          {summary.stats.duplicates > 0 ? <span className="text-muted">{summary.stats.duplicates.toLocaleString()} duplicates removed</span> : null}
          {summary.stats.invalid > 0 ? (
            <span className="text-amber-700" title={summary.invalidSamples.join(", ")}>
              {summary.stats.invalid.toLocaleString()} invalid skipped
            </span>
          ) : null}
          {summary.stats.truncated > 0 ? (
            <span className="text-amber-700">
              {summary.stats.truncated.toLocaleString()} over the {summary.maxRecipients.toLocaleString()} recipient limit were left out
            </span>
          ) : null}
        </p>
      ) : null}

      {shownError ? (
        <p role="alert" className="ml-23 text-xs font-medium text-red-600">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
