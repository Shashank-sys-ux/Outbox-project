import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { ApiError, setUnauthorizedHandler } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";
import { authApi } from "../services/api";
import type { User } from "../types/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: unknown;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await authApi.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchCurrentUser, staleTime: 60_000, retry: 1 });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (queryClient.getQueryData(queryKeys.me)) {
        queryClient.setQueryData(queryKeys.me, null);
      }
    });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ user: me.data ?? null, loading: me.isPending, error: me.error, logout }),
    [me.data, me.isPending, me.error, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
