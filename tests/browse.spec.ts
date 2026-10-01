import { expect, test } from '../support/fixtures';
import { signIn } from '../support/pages/auth';

const COMPETITIONS = [
  'ASMO',
  'TIMO',
  'HKIMO',
  'BBB',
  'FMO',
  'AIMO',
  'SEAMO',
  'Kangaroo (IKMC)',
  'SASMO',
  'ITMC',
  'IMAS',
  'AMC',
  'AMO',
  'VTMO',
];

test.describe('Competition browser', { tag: '@smoke' }, () => {
  test('E2E-BRW-01 · Competitions by grade, Grade 1 by default', async ({ page, accounts }) => {
    const student = await accounts.customer();
    await signIn(page, student.email, student.password);

    const grades = page.getByRole('group', { name: 'Grade' });
    const titles = page
      .getByRole('region', { name: /Competitions for Grade/ })
      .getByRole('listitem')
      .locator('p.text-lg');

    await expect(grades.getByRole('button', { name: 'Grade 1', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Competitions for Grade 1' })).toBeVisible();
    await expect(titles).toHaveText(COMPETITIONS.map((c) => `${c} Grade 1`));

    await grades.getByRole('button', { name: 'Grade 5', exact: true }).click();
    await expect(page).toHaveURL('/?grade=5');
    await expect(titles).toHaveText(COMPETITIONS.map((c) => `${c} Grade 5`));

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Competitions for Grade 5' })).toBeVisible();

    await grades.getByRole('button', { name: 'Grade 1', exact: true }).click();
    await expect(page).toHaveURL('/');
  });
});
