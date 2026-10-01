import { randomInt } from 'node:crypto';
import { env } from './env';

/** The password every account made by the tests gets (letters and digits, 8+). */
export const PASSWORD = 'Test1234';

let counter = 0;

/**
 * A value no other test, worker or run uses: emails, phone numbers and names
 * must be unique, and the tests run in parallel against a shared database.
 */
export function unique(prefix: string): string {
  const run = process.env.E2E_RUN_ID ?? Date.now().toString(36);
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  counter += 1;
  return `${prefix}-${run}-w${worker}-${counter}`;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${unique(prefix)}@${env.mailDomain}`.toLowerCase();
}

// Long-established mobile prefixes (Viettel, VinaPhone, MobiFone) that
// libphonenumber, which the API validates with, accepts.
const PREFIXES = ['090', '091', '093', '094', '096', '097', '098'];

/** A random Vietnamese mobile number in local format, e.g. 0912345678. */
export function uniquePhone(): string {
  const prefix = PREFIXES[randomInt(0, PREFIXES.length)]!;
  return `${prefix}${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
}

/** The same number in the international form the API stores (+84…). */
export function toE164(localPhone: string): string {
  return `+84${localPhone.replace(/\D/g, '').replace(/^0/, '')}`;
}
