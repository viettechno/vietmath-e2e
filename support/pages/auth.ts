import { expect, type Page } from '@playwright/test';
import { env } from '../env';

/** An address on the admin web (staff); plain paths are on the student web. */
export function adminSite(path = '/'): string {
  return env.adminURL + path;
}

/** Signs in on the student web's sign-in page and waits until the app moves on. */
export async function signIn(page: Page, email: string, password: string) {
  await signInAt(page, '/login', email, password);
}

/** Signs a staff account in on the admin web. */
export async function signInStaff(page: Page, email: string, password: string) {
  await signInAt(page, adminSite('/login'), email, password);
}

async function signInAt(page: Page, loginURL: string, email: string, password: string) {
  await page.goto(loginURL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Whether the browser is signed out: a signed-in-only page asks to sign in. */
export async function expectSignedOut(page: Page) {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
}

/** A success notice (role="status"; loading spinners share the role). */
export async function expectNotice(page: Page, text: string) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}
