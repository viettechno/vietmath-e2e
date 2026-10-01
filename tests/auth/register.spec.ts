import { PASSWORD, toE164, uniqueEmail, uniquePhone } from '../../support/data';
import { expect, test } from '../../support/fixtures';
import { Inbox, mailAvailable } from '../../support/mailpit';

test.describe('Registration', { tag: '@smoke' }, () => {
  test.skip(!mailAvailable, 'needs Mailpit to read the email code');

  test('E2E-REG-01 · Register a student, verify the email, get signed in', async ({ page }) => {
    const email = uniqueEmail('reg');
    const phone = uniquePhone();
    const inbox = new Inbox(email);

    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Student' })).toBeChecked();
    await page.getByLabel('Full name').fill('Minh Anh');
    await page.getByLabel('Email').fill(email);
    await page
      .getByLabel('Phone number')
      .fill(`${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(page.getByText(/It is valid for 10 minutes\./)).toBeVisible();

    const { code, subject } = await inbox.nextCode();
    expect(subject).toBe('Your VietMath verification code');
    await page.getByLabel('Verification code').fill(code);
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Hello, Minh Anh' })).toBeVisible();

    await page.goto('/account');
    const profile = page.getByRole('region', { name: 'Profile' });
    await expect(profile).toContainText(toE164(phone));
    await expect(profile).toContainText('Student');
    await expect(profile).toContainText('Email and password');
  });
});
