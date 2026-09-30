import { expect, test } from '../support/fixtures';

test.describe('Interface language', { tag: '@smoke' }, () => {
  // A browser that never chose a language: the app's default applies.
  test.use({ uiLanguage: null });

  test('E2E-I18N-01 · Vietnamese by default, switch to English', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Luyện thi toán cho học sinh lớp 1' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếng Việt' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'English' }).first().click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Math competition practice for Grade 1' }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Math competition practice for Grade 1' }),
    ).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@vietmath.test');
    await page.getByLabel('Password', { exact: true }).fill('Wrong1234');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

    await page.getByRole('button', { name: 'Tiếng Việt' }).first().click();
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
  });
});
