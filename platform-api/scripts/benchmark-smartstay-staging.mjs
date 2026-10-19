#!/usr/bin/env node
/**
 * Staging-only SmartStay discovery benchmark.
 *
 * Required:
 *   SMARTSTAY_BASE_URL=https://<staging-host>
 *   SMARTSTAY_ARRIVAL_DATE=2030-11-10
 *   SMARTSTAY_DEPARTURE_DATE=2030-11-12
 * Optional: SMARTSTAY_DESTINATION, SMARTSTAY_P95_BUDGET_MS (default 5000).
 *
 * Uses public, read-only availability searches. Never targets production.
 */
const base = process.env.SMARTSTAY_BASE_URL;
if (!base) throw new Error("SMARTSTAY_BASE_URL is required");
const target = new URL(base);
if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname))) {
  throw new Error("Benchmark requires HTTPS or local HTTP");
}
if (/(^|\\.)wildleafstays\\.com$|(^|\\.)firebaseapp\\.com$|(^|\\.)web\\.app$/.test(target.hostname)) {
  throw new Error("Refusing to benchmark production or public Firebase domains");
}
const arrivalDate = process.env.SMARTSTAY_ARRIVAL_DATE;
const departureDate = process.env.SMARTSTAY_DEPARTURE_DATE;
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(arrivalDate || "") || !/^\\d{4}-\\d{2}-\\d{2}$/.test(departureDate || "") || departureDate <= arrivalDate) {
  throw new Error("Provide valid ordered SMARTSTAY_ARRIVAL_DATE and SMARTSTAY_DEPARTURE_DATE");
}
const budget = Number(process.env.SMARTSTAY_P95_BUDGET_MS || 5000);
if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid p95 budget");
const samples = [];
const errors = [];
let totalScanned = 0;
let offset = 0;
const startedAt = performance.now();
const url = new URL("/v1/public/smartstay/search", target);
for (let page = 0; page < 8; page += 1) {
  const body = {
    arrivalDate,
    departureDate,
    adults: 2,
    childAges: [],
    requestedRooms: 1,
    exclusive: false,
    limit: 25,
    offset,
    ...(process.env.SMARTSTAY_DESTINATION ? { destination: process.env.SMARTSTAY_DESTINATION } : {})
  };
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const duration = Math.round(performance.now() - started);
    samples.push(duration);
    if (!response.ok) {
      errors.push({ page, status: response.status });
      break;
    }
    const data = await response.json();
    if (!Array.isArray(data.properties) || !Number.isInteger(data.scanned) || data.scanned < 0) {
      errors.push({ page, error: "Malformed public search response" });
      break;
    }
    totalScanned += data.scanned;
    if (data.nextOffset === null) break;
    if (!Number.isInteger(data.nextOffset) || data.nextOffset <= offset) {
      errors.push({ page, error: "Invalid pagination cursor" });
      break;
    }
    offset = data.nextOffset;
  } catch (error) {
    errors.push({ page, error: String(error) });
    break;
  }
}
const sorted = [...samples].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
const report = {
  target: target.origin,
  pages: samples.length,
  propertiesScanned: totalScanned,
  elapsedMs: Math.round(performance.now() - startedAt),
  latencyMs: { min: sorted[0] ?? null, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null },
  errors,
  p95BudgetMs: budget,
  passed: totalScanned >= 200 && errors.length === 0 && percentile(0.95) <= budget
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
