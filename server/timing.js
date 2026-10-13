import { AsyncLocalStorage } from "node:async_hooks";

// Where an API request's time went, for spotting slow spots: database time
// and query count, AI time, total, and whether this function instance had
// just started ("cold"). Sent as a Server-Timing header (browser dev tools,
// Network → Timing) and logged as one JSON line ("event":"timing") in the
// Netlify function logs.
const store = new AsyncLocalStorage();
let warm = false;

// Adds milliseconds to a bucket ("db", "ai") for the current request.
// Outside a request (tests, scripts) it does nothing.
export function timed(name, ms) {
  const t = store.getStore();
  if (!t) return;
  t[name] = (t[name] ?? 0) + ms;
  if (name === "db") t.queries += 1;
}

export function withTiming(handler) {
  return async (request, context) => {
    const cold = !warm;
    warm = true;
    const t = { queries: 0 };
    const start = performance.now();
    const response = await store.run(t, () => handler(request, context));
    const total = Math.round(performance.now() - start);
    const db = Math.round(t.db ?? 0);
    const ai = Math.round(t.ai ?? 0);
    const parts = [
      `db;dur=${db};desc="${t.queries} ${t.queries === 1 ? "query" : "queries"}"`,
      ...(ai ? [`ai;dur=${ai}`] : []),
      `total;dur=${total}`,
      ...(cold ? ["cold"] : []),
    ];
    console.log(
      JSON.stringify({
        event: "timing",
        path: new URL(request.url).pathname,
        method: request.method,
        total,
        db,
        queries: t.queries,
        ai,
        cold,
      }),
    );
    // Responses can have immutable headers, so copy into a new one.
    const headers = new Headers(response.headers);
    headers.set("Server-Timing", parts.join(", "));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

// Times an async call into a bucket, e.g. measure("ai", () => api.create(…)).
export async function measure(name, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timed(name, performance.now() - start);
  }
}
