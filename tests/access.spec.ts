import type { Page } from '@playwright/test';
import type { StaffRole } from '../support/api';
import { expect, test } from '../support/fixtures';
import { signIn } from '../support/pages/auth';

type Who = 'signed out' | 'student' | StaffRole;

const PAGES = [
  '/staff',
  '/staff/users',
  '/staff/questions',
  '/staff/questions/new',
  '/staff/review',
  '/staff/content-gaps',
  '/staff/topics',
  '/staff/exam-packs',
  '/account',
] as const;

/** Which pages each role may open (vietmath-docs/08_E2E_Test_Scenarios.md, E2E-ACL-01). */
const ALLOWED: Record<Who, readonly (typeof PAGES)[number][]> = {
  'signed out': [],
  student: ['/account'],
  CONTENT_CREATOR: [
    '/staff',
    '/staff/questions',
    '/staff/questions/new',
    '/staff/content-gaps',
    '/staff/topics',
    '/account',
  ],
  REVIEWER: ['/staff', '/staff/questions', '/staff/review', '/staff/content-gaps', '/account'],
  SYSTEM_ADMIN: PAGES.filter((p) => p !== '/staff/questions/new'),
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
  await page.goto(path);
  if (!signedIn) {
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    return;
  }
  await expect(page).toHaveURL(path);
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
        const account = who === 'student' ? await accounts.customer() : await accounts.staff(who);
        await signIn(page, account.email, account.password);
      }

      for (const path of PAGES) {
        await expectPage(page, path, ALLOWED[who].includes(path), who !== 'signed out');
      }

      const sidebar = SIDEBAR[who];
      if (sidebar) {
        await page.goto('/staff');
        const nav = page.getByRole('navigation', { name: 'Staff', exact: true });
        await expect(nav.getByRole('link')).toHaveText(sidebar);
      }
      const staffLink = page.getByRole('link', { name: 'Staff console' });
      await page.goto('/');
      await expect(staffLink).toHaveCount(sidebar ? 1 : 0);
    });
  }
});
