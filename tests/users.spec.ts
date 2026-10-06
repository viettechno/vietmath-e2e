import { Api } from '../support/api';
import { PASSWORD, uniqueEmail, uniquePhone } from '../support/data';
import { expect, test } from '../support/fixtures';
import {
  adminSite,
  expectNotice,
  expectSignedOut,
  signIn,
  signInStaff,
} from '../support/pages/auth';

test.describe('User management', { tag: '@smoke' }, () => {
  test('E2E-USR-01 · Create a Content Creator and a Reviewer', async ({
    page,
    newBrowser,
    accounts,
  }) => {
    const admin = await accounts.staff('SYSTEM_ADMIN');
    await signInStaff(page, admin.email, admin.password);

    for (const role of ['Content creator', 'Reviewer']) {
      const email = uniqueEmail('staff');
      const fullName = `New ${role}`;

      await page
        .getByRole('navigation', { name: 'Staff', exact: true })
        .getByRole('link', { name: 'Users' })
        .click();
      await page.getByRole('link', { name: 'Add staff account' }).click();
      await page.getByLabel('Full name').fill(fullName);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Phone number').fill(uniquePhone());
      await page.getByLabel('Role').selectOption({ label: role });
      await page.getByLabel('Initial password').fill('Staff1234');
      await page.getByRole('button', { name: 'Create account' }).click();

      await expectNotice(page, 'Staff account created.');
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByText(/Staff since/)).toBeVisible();

      // The new account signs in straight away, no email verification.
      const staffBrowser = await newBrowser();
      await signInStaff(staffBrowser, email, 'Staff1234');
      await expect(staffBrowser).toHaveURL(adminSite('/'));
      // Accounts made by an admin start in Vietnamese, the app's default.
      await staffBrowser.getByRole('button', { name: 'English' }).first().click();
      await expect(staffBrowser.getByText(`Signed in as ${fullName} (${role}).`)).toBeVisible();
    }
  });

  test('E2E-USR-05 · Disable and re-enable an account', async ({ page, newBrowser, accounts }) => {
    const admin = await accounts.staff('SYSTEM_ADMIN');
    const student = await accounts.customer();
    const studentBrowser = await newBrowser();
    await signIn(studentBrowser, student.email, student.password);

    const setStatus = async (status: 'Disabled' | 'Active') => {
      await page.goto(adminSite('/users'));
      await page.getByLabel('Search').fill(student.email);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText('1 user', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: `Edit ${student.fullName}` }).click();
      await page.getByLabel('Status').selectOption({ label: status });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expectNotice(
        page,
        'Changes saved. Changing the role or disabling the account signs the user out.',
      );
    };

    await signInStaff(page, admin.email, admin.password);
    await setStatus('Disabled');

    await expectSignedOut(studentBrowser);
    await studentBrowser.getByLabel('Email').fill(student.email);
    await studentBrowser.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await studentBrowser.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(studentBrowser.getByRole('alert')).toHaveText(
      'This account has been disabled. Please contact support.',
    );

    await setStatus('Active');
    await expect(Api.login(student.email, PASSWORD, 'PC')).resolves.toBeInstanceOf(Api);
  });
});
