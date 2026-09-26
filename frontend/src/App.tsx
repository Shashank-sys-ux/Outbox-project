import { useEffect, useState } from "react";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; timestamp: string }
  | { kind: "error"; message: string };

interface HealthResponse {
  data: {
    status: string;
    timestamp: string;
  };
}

export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const body = (await response.json()) as HealthResponse;
        setHealth({ kind: "ok", timestamp: body.data.timestamp });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setHealth({
          kind: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Outbox Scheduler</h1>
        <p className="mt-2 text-sm text-gray-500">Frontend to backend connectivity check</p>
        <div className="mt-6" role="status" aria-live="polite">
          {health.kind === "loading" && <p className="text-gray-600">Checking backend...</p>}
          {health.kind === "ok" && (
            <p className="font-medium text-green-700">
              Backend is healthy (checked at {new Date(health.timestamp).toLocaleTimeString()})
            </p>
          )}
          {health.kind === "error" && (
            <p className="font-medium text-red-700">Backend unreachable: {health.message}</p>
          )}
        </div>
      </section>
    </main>
  );
}
