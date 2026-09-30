import type { StaffRole } from '../../support/api';
import { uniqueEmail } from '../../support/data';
import { expect, test } from '../../support/fixtures';
import { signIn } from '../../support/pages/auth';

test.describe('Sign in', { tag: '@smoke' }, () => {
  test('E2E-LOGIN-01 · Students land on the home page', async ({ page, accounts }) => {
    const student = await accounts.customer('STUDENT');

    await signIn(page, student.email, student.password);

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: `Hello, ${student.fullName}` }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Staff console' })).toHaveCount(0);
  });

  const staffRoles: [StaffRole, string][] = [
    ['SYSTEM_ADMIN', 'System admin'],
    ['CONTENT_CREATOR', 'Content creator'],
    ['REVIEWER', 'Reviewer'],
  ];
  for (const [role, label] of staffRoles) {
    test(`E2E-LOGIN-02 · Staff land on the staff console (${label})`, async ({
      page,
      accounts,
    }) => {
      const staff = await accounts.staff(role);

      await signIn(page, staff.email, staff.password);

      await expect(page).toHaveURL('/staff');
      await expect(page.getByText(`Signed in as ${staff.fullName} (${label}).`)).toBeVisible();
    });
  }

  test('E2E-LOGIN-03 · Wrong credentials', async ({ page, accounts }) => {
    const staff = await accounts.staff('REVIEWER');
    const tryLogin = async (email: string, password: string) => {
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    };

    await page.goto('/login');
    await tryLogin(staff.email, 'Wrong1234');
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

    // The same answer for an unknown email: the app does not reveal who has an account.
    await tryLogin(uniqueEmail('nobody'), 'Wrong1234');
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
    await expect(page).toHaveURL('/login');
  });
});
