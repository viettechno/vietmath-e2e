import { publicApi } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { Inbox, mailAvailable } from '../../support/mailpit';
import { expectSignedOut, signIn } from '../../support/pages/auth';

test.describe('Passwords', { tag: '@smoke' }, () => {
  test.skip(!mailAvailable, 'needs Mailpit to read the email code');

  test('E2E-PWD-01 · Reset a forgotten password', async ({ page, newBrowser, accounts }) => {
    const student = await accounts.customer();
    const newPassword = 'NewPass123';
    const inbox = new Inbox(student.email);

    // Signed in elsewhere: a reset signs out every device.
    const otherComputer = await newBrowser();
    await signIn(otherComputer, student.email, student.password);

    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await page.getByLabel('Email').fill(student.email);
    await inbox.mark();
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
    await expect(page.getByText(/It expires in 2 minutes\./)).toBeVisible();
    const { code, subject } = await inbox.nextCode();
    expect(subject).toBe('Your VietMath password reset code');
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page.getByLabel('New password').fill(newPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();

    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    await expect(
      page.getByText('Your password has been changed and you were signed out of all devices.'),
    ).toBeVisible();

    await expectSignedOut(otherComputer);
    await expect(publicApi.login(student.email, student.password)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    await signIn(page, student.email, newPassword);
    await expect(page).toHaveURL('/');
  });
});
