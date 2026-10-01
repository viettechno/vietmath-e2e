import { publicApi } from './api';
import { env } from './env';

/**
 * Checks that the app is up and the admin account works before any test runs,
 * so a broken setup fails once with a clear message instead of in every test.
 */
export default async function globalSetup() {
  // Shared by all workers: makes this run's emails and names unique (see data.ts).
  process.env.E2E_RUN_ID ??= Date.now().toString(36);

  try {
    const hello = await publicApi.hello();
    console.log(`Testing ${env.baseURL} (API version ${hello.version})`);
  } catch (err) {
    throw new Error(
      `The app at ${env.baseURL} is not reachable. Start it with scripts/stack-up.sh or set E2E_BASE_URL. (${String(err)})`,
    );
  }

  try {
    await publicApi.login(env.adminEmail, env.adminPassword);
  } catch (err) {
    throw new Error(
      `Cannot sign in as ${env.adminEmail} (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD). (${String(err)})`,
    );
  }

  if (env.mailpitURL) {
    const res = await fetch(`${env.mailpitURL}/api/v1/info`).catch(() => undefined);
    if (!res?.ok) {
      throw new Error(
        `Mailpit is not reachable at ${env.mailpitURL}. Set E2E_MAILPIT_URL= (empty) to skip the tests that read emails.`,
      );
    }
  }
}
