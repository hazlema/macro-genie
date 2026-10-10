// Approximate list prices in USD per million tokens (October 2026). Used for
// cost logging only; the billing dashboard is the source of truth.
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
export const MODELS = Object.keys(PRICES);

// A request can fall back to another model; price by the model that answered.
const priceFor = (model) =>
  PRICES[model] ??
  Object.entries(PRICES).find(([id]) => model?.startsWith(id))?.[1] ??
  PRICES["claude-opus-5-5"];

export function emptyUsage(model) {
  return { model, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

// Adds one response's usage to a running total.
export function addUsage(total, response) {
  const u = response?.usage ?? {};
  total.calls += 1;
  total.input += u.input_tokens ?? 0;
  total.output += u.output_tokens ?? 0;
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
  if (response?.model) total.model = response.model;
  return total;
}

export function costOf(total) {
  const p = priceFor(total.model);
  const usd =
    (total.input * p.input +
      total.cacheWrite * p.input * 1.25 +
      total.cacheRead * p.cacheRead +
      total.output * p.output) /
    1e6;
  return Math.round(usd * 10000) / 10000;
}

// One JSON line per job in the Netlify function logs; search for "ai_usage".
export function logUsage(step, total, extra = {}) {
  const line = {
    event: "ai_usage",
    step,
    ...total,
    costUsd: costOf(total),
    ...extra,
  };
  console.log(JSON.stringify(line));
  return line;
}
