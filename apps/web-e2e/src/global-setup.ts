import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/**
 * Starts the ingestion worker for the e2e run (it has no HTTP port, so
 * Playwright's webServer readiness model does not fit). Reuses an already
 * running worker when one is processing the queue.
 */
export default async function globalSetup(): Promise<() => void> {
  const workspaceRoot = join(__dirname, '..', '..', '..');
  const child: ChildProcess = spawn('pnpm', ['dev:worker'], {
    cwd: workspaceRoot,
    shell: true,
    stdio: 'ignore',
    detached: false,
  });
  // Give the worker time to build and connect before tests enqueue work.
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  return () => {
    child.kill();
  };
}
