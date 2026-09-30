/** Where the tests run, from environment variables (see README). */
export const env = {
  /** The app: web and API on one origin, as in staging and production. */
  baseURL: trimSlash(process.env.E2E_BASE_URL ?? 'http://localhost:8080'),
  /** Mailpit, which catches the OTP emails. Empty: tests that need a code are skipped. */
  mailpitURL: trimSlash(process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'),
  /** An existing System Admin; each test worker creates its own admin from it. */
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? 'admin@vietmath.test',
  adminPassword: process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin123',
  /** Domain of the throwaway email addresses the tests create. */
  mailDomain: process.env.E2E_MAIL_DOMAIN ?? 'vietmath.test',
};

export const apiURL = `${env.baseURL}/api/v1`;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
