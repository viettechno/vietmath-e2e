import { devices } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { expectSignedOut, signIn } from '../../support/pages/auth';

// An account is signed in on at most one computer and one phone at a time.
test.describe('Devices and sessions', { tag: '@smoke' }, () => {
  test('E2E-SESS-01 · A second computer signs out the first', async ({
    page,
    newBrowser,
    accounts,
  }) => {
    const student = await accounts.customer();

    await signIn(page, student.email, student.password);
    await page.goto('/account');
    const devicesList = page.getByRole('region', { name: 'Signed-in devices' });
    await expect(devicesList.getByRole('listitem').filter({ hasText: 'Computer' })).toHaveCount(1);
    await expect(
      devicesList.getByRole('listitem').filter({ hasText: 'This device' }),
    ).toContainText('Computer');

    const secondComputer = await newBrowser();
    await signIn(secondComputer, student.email, student.password);

    await expectSignedOut(page);
  });

  test('E2E-SESS-02 · A computer and a phone can be signed in together', async ({
    page,
    newBrowser,
    accounts,
  }) => {
    const student = await accounts.customer();

    await signIn(page, student.email, student.password);
    const phone = await newBrowser({ ...devices['Pixel 7'] });
    await signIn(phone, student.email, student.password);

    await page.goto('/account');
    const devicesList = page.getByRole('region', { name: 'Signed-in devices' });
    await expect(devicesList.getByRole('listitem').filter({ hasText: 'Computer' })).toHaveCount(1);
    await expect(
      devicesList.getByRole('listitem').filter({ hasText: 'Phone or tablet' }),
    ).toHaveCount(1);
    await expect(devicesList).toContainText('Last active');

    // A second phone replaces the first phone only.
    const secondPhone = await newBrowser({ ...devices['Pixel 7'] });
    await signIn(secondPhone, student.email, student.password);

    await expectSignedOut(phone);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  });
});
