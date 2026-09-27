interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const SIZES = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-10 w-10 border-[3px]" };

export function Spinner({ size = "md", label }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`${SIZES[size]} inline-block animate-spin rounded-full border-current border-r-transparent opacity-80`}
      />
      {label ? <span className="text-sm text-muted">{label}</span> : null}
    </span>
  );
}

export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center text-brand-600">
      <Spinner size="lg" label={label} />
    </div>
  );
}
