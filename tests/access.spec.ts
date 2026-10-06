import type { Page } from '@playwright/test';
import type { StaffRole } from '../support/api';
import { expect, test } from '../support/fixtures';
import { adminSite, signInStaff } from '../support/pages/auth';

type Who = 'signed out' | StaffRole;

/** Admin web pages (students and parents can't sign in there at all: E2E-LOGIN-02a). */
const PAGES = [
  '/',
  '/users',
  '/questions',
  '/questions/new',
  '/review',
  '/content-gaps',
  '/topics',
  '/exam-packs',
  '/account',
] as const;

/** Which pages each role may open (vietmath-docs/08_E2E_Test_Scenarios.md, E2E-ACL-01). */
const ALLOWED: Record<Who, readonly (typeof PAGES)[number][]> = {
  'signed out': [],
  CONTENT_CREATOR: ['/', '/questions', '/questions/new', '/content-gaps', '/topics', '/account'],
  REVIEWER: ['/', '/questions', '/review', '/content-gaps', '/account'],
  SYSTEM_ADMIN: PAGES.filter((p) => p !== '/questions/new'),
};

const SIDEBAR: Partial<Record<Who, string[]>> = {
  CONTENT_CREATOR: ['Dashboard', 'Question bank', 'Content gaps', 'Topics'],
  REVIEWER: ['Dashboard', 'Question bank', 'Review queue', 'Content gaps'],
  SYSTEM_ADMIN: [
    'Dashboard',
    'Users',
    'Question bank',
    'Review queue',
    'Content gaps',
    'Topics',
    'Exam packs',
  ],
};

async function expectPage(page: Page, path: string, allowed: boolean, signedIn: boolean) {
  await page.goto(adminSite(path));
  if (!signedIn) {
    await expect(page).toHaveURL(adminSite(`/login?next=${encodeURIComponent(path)}`));
    return;
  }
  await expect(page).toHaveURL(adminSite(path));
  const denied = page.getByRole('heading', { name: 'Access denied' });
  if (allowed) {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(denied).toHaveCount(0);
  } else {
    await expect(denied).toBeVisible();
  }
}

test.describe('Role-based access', { tag: '@smoke' }, () => {
  for (const who of Object.keys(ALLOWED) as Who[]) {
    test(`E2E-ACL-01 · Page access: ${who}`, async ({ page, accounts }) => {
      if (who !== 'signed out') {
        const account = await accounts.staff(who);
        await signInStaff(page, account.email, account.password);
      }

      for (const path of PAGES) {
        await expectPage(page, path, ALLOWED[who].includes(path), who !== 'signed out');
      }

      const sidebar = SIDEBAR[who];
      if (sidebar) {
        await page.goto(adminSite('/'));
        const nav = page.getByRole('navigation', { name: 'Staff', exact: true });
        await expect(nav.getByRole('link')).toHaveText(sidebar);
      }
    });
  }
});
