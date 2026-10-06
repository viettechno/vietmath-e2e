import type { StaffRole } from '../../support/api';
import { uniqueEmail } from '../../support/data';
import { expect, test } from '../../support/fixtures';
import { adminSite, signIn, signInStaff } from '../../support/pages/auth';

test.describe('Sign in', { tag: '@smoke' }, () => {
  test('E2E-LOGIN-01 · Students land on the home page', async ({ page, accounts }) => {
    const student = await accounts.customer('STUDENT');

    await signIn(page, student.email, student.password);

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: `Hello, ${student.fullName}` }),
    ).toBeVisible();
  });

  const staffRoles: [StaffRole, string][] = [
    ['SYSTEM_ADMIN', 'System admin'],
    ['CONTENT_CREATOR', 'Content creator'],
    ['REVIEWER', 'Reviewer'],
  ];
  for (const [role, label] of staffRoles) {
    test(`E2E-LOGIN-02 · Staff sign in on the admin web (${label})`, async ({ page, accounts }) => {
      const staff = await accounts.staff(role);

      await signInStaff(page, staff.email, staff.password);

      await expect(page).toHaveURL(adminSite('/'));
      await expect(page.getByText(`Signed in as ${staff.fullName} (${label}).`)).toBeVisible();
    });
  }

  test('E2E-LOGIN-02a · Each site turns away the other audience', async ({ page, accounts }) => {
    const tryLogin = async (url: string, email: string, password: string) => {
      await page.goto(url);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    };
    const staff = await accounts.staff('SYSTEM_ADMIN');
    const student = await accounts.customer('STUDENT');

    await tryLogin('/login', staff.email, staff.password);
    await expect(page.getByRole('alert')).toContainText(
      'Staff accounts sign in on the VietMath admin site',
    );
    await expect(page).toHaveURL('/login');

    await tryLogin(adminSite('/login'), student.email, student.password);
    await expect(page.getByRole('alert')).toContainText('This site is for the VietMath team.');
    await expect(page).toHaveURL(adminSite('/login'));

    // Neither attempt left a session behind.
    await page.goto(adminSite('/account'));
    await expect(page).toHaveURL(adminSite('/login?next=%2Faccount'));
    await page.goto('/account');
    await expect(page).toHaveURL('/login?next=%2Faccount');
  });

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
