import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const CONTROL =
  "w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 " +
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas aria-[invalid=true]:border-red-400";

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
  inline?: boolean;
}

export function FieldShell({ label, error, hint, children, className = "", inline = false }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`${inline ? "flex items-center gap-3" : "flex flex-col gap-1.5"} ${className}`}>
      <label htmlFor={id} className={`text-sm font-medium ${inline ? "w-20 shrink-0 text-muted" : "text-ink"}`}>
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children({ id, describedBy, invalid: Boolean(error) })}
        {hint ? (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Shared = { label: string; error?: string | undefined; hint?: ReactNode; inline?: boolean; wrapperClassName?: string };

export function TextField({ label, error, hint, inline, wrapperClassName, className = "", ...rest }: Shared & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} inline={inline ?? false} className={wrapperClassName ?? ""}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${CONTROL} h-10 ${className}`}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, error, hint, wrapperClassName, className = "", ...rest }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={wrapperClassName ?? ""}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${CONTROL} py-2.5 ${className}`}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  inline,
  wrapperClassName,
  className = "",
  children,
  ...rest
}: Shared & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} inline={inline ?? false} className={wrapperClassName ?? ""}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${CONTROL} h-10 ${className}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
