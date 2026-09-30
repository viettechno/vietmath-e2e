import { expect, test } from '../support/fixtures';

test.describe('Deployment and routing', { tag: '@smoke' }, () => {
  test('E2E-SYS-01 · The app and the API are reachable', async ({ page, request }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Math competition practice for Grade 1' }),
    ).toBeVisible();
    for (const name of ['Asmo', 'Timo', 'Fmo']) {
      await expect(page.getByText(`${name} Grade 1`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('API online')).toBeVisible();

    const hello = await request.get('/api/v1/hello');
    expect(hello.ok()).toBe(true);
    expect(await hello.json()).toMatchObject({ message: 'Hello from VietMath API' });
  });

  test('E2E-SYS-02 · Deep links and unknown pages', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();

    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login\?next=%2Fstaff$/);
  });
});
