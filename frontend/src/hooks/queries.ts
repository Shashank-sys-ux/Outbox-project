import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "../lib/query-keys";
import { configApi, emailsApi, searchApi, sendersApi, slackApi } from "../services/api";
import type { EmailView } from "../types/api";

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: configApi.get, staleTime: 5 * 60_000 });
}

export function useEmailStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: emailsApi.stats, refetchInterval: 5000 });
}

export function useEmailList(view: EmailView, page: number, pageSize = 20) {
  return useQuery({
    queryKey: queryKeys.emails(view, page),
    queryFn: ({ signal }) => emailsApi.list({ view, page, pageSize }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: view === "scheduled" ? 3000 : 5000,
  });
}

export function useEmailSearch(q: string, view: EmailView, page: number, pageSize = 20) {
  return useQuery({
    queryKey: queryKeys.search(q, view, page),
    queryFn: ({ signal }) => searchApi.emails({ q, view, page, pageSize }, signal),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useEmail(emailId: string) {
  return useQuery({ queryKey: queryKeys.email(emailId), queryFn: () => emailsApi.get(emailId), refetchInterval: 4000 });
}

export function useSenders() {
  return useQuery({ queryKey: queryKeys.senders, queryFn: sendersApi.list });
}

export function useSlackStatus() {
  return useQuery({ queryKey: queryKeys.slack, queryFn: slackApi.status });
}
