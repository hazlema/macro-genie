// What's worth saying about yesterday, worked out from the site's own
// seven-day history so the morning brief doesn't have to keep any.
// `series` maps a metric name to seven daily counts, index 0 = yesterday;
// `labels` maps the same names to { count(n) -> "3 contact messages",
// none -> "no contact messages" }. A boring day yields an empty list.
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function notableLines(series, labels) {
  const lines = [];
  for (const [name, days] of Object.entries(series)) {
    const label = labels[name];
    if (!label || !Array.isArray(days) || days.length !== 7) continue;
    const [yesterday, ...earlier] = days;
    const avg = days.reduce((a, b) => a + b, 0) / 7;
    const line = rule(yesterday, earlier, avg, label);
    if (line) lines.push(line);
  }
  return lines;
}

// One line per metric; the first rule that fits wins.
function rule(yesterday, earlier, avg, label) {
  const some = `${label.count(yesterday)} yesterday`;
  if (yesterday > 0 && earlier.every((d) => d === 0)) return `${some}, first in a week`;
  if (yesterday >= 5 && yesterday >= 2 * avg)
    return `${some}, well above the week's average of ${avg.toFixed(1)}`;
  if (yesterday >= 3 && earlier.every((d) => d < yesterday)) return `${some}, the most in a week`;
  if (yesterday === 0 && earlier.every((d) => d > 0))
    return `${label.none} yesterday, after six days with some`;
  return null;
}
