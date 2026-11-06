import { expect, test } from '../support/fixtures';
import { expectSignedOut, signIn } from '../support/pages/auth';

test.describe('Navigation', () => {
  test('E2E-LOGIN-04 · Return to the requested page', async ({ page, accounts }) => {
    const student = await accounts.customer();

    await expectSignedOut(page); // opens /account and lands on /login?next=%2Faccount
    await page.getByLabel('Email').fill(student.email);
    await page.getByLabel('Password', { exact: true }).fill(student.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText(student.email);
  });

  test('E2E-LOGIN-06 · Signed-in users skip the sign-in pages', async ({ page, accounts }) => {
    const student = await accounts.customer();
    await signIn(page, student.email, student.password);

    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await expect(page).toHaveURL('/');
    }
  });

  test('E2E-BRW-03 · Parents see the browser too', async ({ page, accounts }) => {
    const parent = await accounts.customer('PARENT');
    await signIn(page, parent.email, parent.password);

    await expect(page.getByRole('heading', { name: 'Competitions for Grade 1' })).toBeVisible();
    await page
      .getByRole('group', { name: 'Grade' })
      .getByRole('button', { name: 'Grade 3' })
      .click();
    await expect(page.getByRole('heading', { name: 'Competitions for Grade 3' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('E2E-SYS-03 · Mobile layout', async ({ page }) => {
      await page.goto('/');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(0);

      const menu = page.getByRole('button', { name: 'Open menu' });
      await expect(menu).toBeVisible();
      await menu.click();

      const nav = page
        .getByRole('navigation')
        .filter({ has: page.getByRole('link', { name: 'Home' }) });
      await expect(nav.first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'English' }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();

      await page.getByRole('link', { name: 'Home' }).first().click();
      await expect(page.getByRole('link', { name: 'Home' })).toHaveCount(0); // the menu closed
    });
  });
});
