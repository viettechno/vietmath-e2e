import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'vietmath-e2e-locks');
const STALE_MS = 60_000;

/**
 * Runs fn while holding a lock shared by the test workers on this machine.
 * Needed where workers share one account: every sign-in ends that account's
 * previous session on the same device type (1 PC + 1 MOBILE).
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const path = join(DIR, name);
  await mkdir(DIR, { recursive: true });
  const deadline = Date.now() + 120_000;

  for (;;) {
    try {
      await mkdir(path);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = await stat(path).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > STALE_MS) await rm(path, { recursive: true, force: true });
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${name}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
