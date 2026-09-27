import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "../../lib/api-client";
import { Button } from "./Button";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-muted">
        {icon ?? <Inbox aria-hidden="true" className="h-6 w-6" />}
      </span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}

export function ErrorState({ error, title = "Something went wrong", onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle aria-hidden="true" className="h-6 w-6" />
      </span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<RotateCw aria-hidden="true" className="h-4 w-4" />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex animate-pulse items-center gap-4 px-6 py-4">
          <span className="h-4 w-48 rounded bg-canvas" />
          <span className="h-6 w-36 rounded-full bg-canvas" />
          <span className="h-4 flex-1 rounded bg-canvas" />
        </li>
      ))}
    </ul>
  );
}
