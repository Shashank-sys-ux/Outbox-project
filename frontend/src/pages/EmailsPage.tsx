import { useQueryClient } from "@tanstack/react-query";
import { Info, PenSquare, RotateCw, Search, SearchX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { EmailRow } from "../components/email/EmailRow";
import { Pagination } from "../components/email/Pagination";
import { buttonClasses } from "../components/ui/Button";
import { EmptyState, ErrorState, RowSkeleton } from "../components/ui/States";
import { useDebouncedValue, useEmailList, useEmailSearch } from "../hooks/queries";
import { queryKeys } from "../lib/query-keys";
import type { EmailView } from "../types/api";

const COPY: Record<EmailView, { title: string; emptyTitle: string; emptyText: string }> = {
  scheduled: {
    title: "Scheduled",
    emptyTitle: "No scheduled emails",
    emptyText: "Emails waiting to be sent show up here, including ones paused by the hourly limit.",
  },
  sent: {
    title: "Sent",
    emptyTitle: "No sent emails yet",
    emptyText: "Delivered and failed emails appear here once the worker processes them.",
  },
};

export function EmailsPage({ view }: { view: EmailView }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(1);
  const query = useDebouncedValue(searchInput.trim(), 300);
  const searching = query.length > 0;

  useEffect(() => {
    setPage(1);
  }, [view, query]);

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, setParams]);

  const list = useEmailList(view, page);
  const search = useEmailSearch(query, view, page);
  const active = searching ? search : list;
  const items = searching ? (search.data?.items ?? []) : (list.data?.items ?? []);
  const total = active.data?.total ?? 0;
  const copy = COPY[view];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.emailsRoot });
    void queryClient.invalidateQueries({ queryKey: ["search"] });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <h1 className="sr-only">{copy.title} emails</h1>
        <label className="relative flex max-w-xl flex-1 items-center">
          <span className="sr-only">Search {copy.title.toLowerCase()} emails</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by recipient, subject or body"
            className="h-10 w-full rounded-lg border border-line bg-canvas pr-9 pl-9 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 rounded p-1 text-muted hover:text-ink"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          className="rounded-lg border border-line p-2.5 text-muted hover:bg-canvas hover:text-ink"
        >
          <RotateCw aria-hidden="true" className={`h-4 w-4 ${active.isFetching ? "animate-spin" : ""}`} />
        </button>
        <span className="ml-auto text-sm text-muted" aria-live="polite">
          {searching && search.data
            ? `${search.data.total.toLocaleString()} results from Elasticsearch in ${search.data.tookMs} ms`
            : list.data
              ? `${list.data.total.toLocaleString()} ${copy.title.toLowerCase()}`
              : ""}
        </span>
      </header>

      <section aria-label={`${copy.title} emails`} className="flex-1 overflow-y-auto">
        {active.isPending ? (
          <RowSkeleton />
        ) : active.isError ? (
          <ErrorState
            error={active.error}
            title={searching ? "Search failed" : `Could not load ${copy.title.toLowerCase()} emails`}
            onRetry={() => void active.refetch()}
          />
        ) : items.length === 0 ? (
          searching ? (
            <EmptyState
              icon={<SearchX aria-hidden="true" className="h-6 w-6" />}
              title="No matching emails"
              description={`Nothing in ${copy.title.toLowerCase()} matches "${query}".`}
            />
          ) : (
            <EmptyState
              title={copy.emptyTitle}
              description={copy.emptyText}
              action={
                <Link to="/compose" className={buttonClasses("primary", "md")}>
                  <PenSquare aria-hidden="true" className="h-4 w-4" />
                  Compose email
                </Link>
              }
            />
          )
        ) : (
          <>
            {view === "sent" && items.some((email) => email.previewUrl) ? (
              <p className="flex items-start gap-2 border-b border-line bg-blue-50 px-6 py-3 text-sm text-blue-800">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Ethereal is a test SMTP server. It accepts these emails but never delivers them to real inboxes.
                  Use <strong>Preview</strong> to see exactly what each recipient would have received.
                </span>
              </p>
            ) : null}
            <ul className="divide-y divide-line">
              {items.map((email) => (
                <EmailRow key={email.id} email={email} view={view} />
              ))}
            </ul>
          </>
        )}
      </section>

      <Pagination page={page} pageSize={20} total={total} onChange={setPage} />
    </div>
  );
}
