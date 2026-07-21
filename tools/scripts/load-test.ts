/**
 * Small dependency-free load probe (PLAN.md Phase 10): concurrent requests
 * against a running local API, reporting throughput and latency percentiles.
 * It exercises the read path and the rate limiter — it is not a substitute
 * for a full-scale load test.
 *
 *   pnpm tsx tools/scripts/load-test.ts [--url http://localhost:3000] [--seconds 10] [--concurrency 20]
 */

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const base = arg('url', 'http://localhost:3000');
  const seconds = Number(arg('seconds', '10'));
  const concurrency = Number(arg('concurrency', '20'));
  const deadline = Date.now() + seconds * 1000;
  const latencies: number[] = [];
  let ok = 0;
  let rateLimited = 0;
  let failed = 0;

  async function workerLoop(): Promise<void> {
    while (Date.now() < deadline) {
      const started = Date.now();
      try {
        const response = await fetch(`${base}/documents`);
        latencies.push(Date.now() - started);
        if (response.status === 429) rateLimited++;
        else if (response.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }

  console.log(
    `[load] ${concurrency} workers against ${base}/documents for ${seconds}s`,
  );
  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  console.log(`requests:     ${latencies.length} (${(latencies.length / seconds).toFixed(0)}/s)`);
  console.log(`ok:           ${ok}`);
  console.log(`rate-limited: ${rateLimited} (429 — limiter working)`);
  console.log(`failed:       ${failed}`);
  console.log(`latency p50:  ${pct(50)}ms  p95: ${pct(95)}ms  p99: ${pct(99)}ms`);
  if (failed > latencies.length * 0.01) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[load] failed:', error);
  process.exit(1);
});
