import { publicApi } from '../support/api';
import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';

test.describe('Exam packs and topics', { tag: '@smoke' }, () => {
  test('E2E-CAT-01 · Create an exam pack; only packs on sale are public', async ({
    page,
    admin,
    accounts,
  }) => {
    // One pack per grade × competition: pick a pair nobody used yet
    // (Grade 1 ASMO is kept for the question tests).
    const taken = new Set(
      (await admin.examPacks()).map((p) => `${p.grade.id}:${p.competition.id}`),
    );
    const free = [];
    for (let grade = 2; grade <= 12; grade++) {
      for (const c of await publicApi.competitions(grade)) {
        if (!taken.has(`${grade}:${c.id}`)) free.push({ grade, competition: c });
      }
    }
    test.skip(free.length === 0, 'every grade × competition already has an exam pack');
    const { grade, competition } = free[Math.floor(Math.random() * free.length)]!;
    const name = `${competition.name} Grade ${grade}`;

    const user = await accounts.staff('SYSTEM_ADMIN');
    await signInStaff(page, user.email, user.password);
    await page.goto(adminSite('/exam-packs'));

    const form = page.getByRole('form', { name: 'New exam pack' });
    await form.getByLabel('Grade').selectOption({ label: `Grade ${grade}` });
    await form.getByLabel('Competition').selectOption({ label: competition.name });
    await form.getByLabel('Price (VND)').fill('499000');
    await form.getByLabel('Validity').selectOption({ label: '12 months' });
    // A new pack is a draft: there is no status to choose.
    await expect(form.getByLabel('Status')).toHaveCount(0);
    await form.getByRole('button', { name: 'Create pack' }).click();

    await expectNotice(page, 'Exam pack created as a draft.');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Draft');
    await expect(row).toContainText('12 months');
    // A draft pack is hidden from students and the public.
    expect((await publicApi.examPacks()).map((p) => p.name)).not.toContain(name);

    // It is put on sale after it is made. It has no exam yet, so the warning is confirmed (E2E-ORD-13).
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const editRow = page.getByRole('row').filter({ has: page.getByLabel('Status') });
    await editRow.getByLabel('Status').selectOption({ label: 'On sale' });
    await editRow.getByRole('button', { name: 'Save', exact: true }).click();
    await editRow.getByRole('button', { name: 'Put on sale anyway' }).click();
    await expectNotice(page, 'Exam pack updated.');
    await expect(row).toContainText('On sale');
    expect((await publicApi.examPacks()).map((p) => p.name)).toContain(name);
  });

  test('E2E-CAT-04 · Topics', async ({ page, newBrowser, accounts }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const first = unique('Time');
    const second = unique('Geometry');

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/topics'));
    const form = page.getByRole('form', { name: 'Add a topic' });
    // A topic has no competition: it is shared by everything that uses it.
    await expect(form.getByLabel('Competition')).toHaveCount(0);

    const addTopic = async (nameEn: string) => {
      await form.getByLabel('Name (English)').fill(nameEn);
      await form.getByLabel('Name (Vietnamese)').fill(`${nameEn} (vi)`);
      await form.getByRole('button', { name: 'Add topic' }).click();
      await expectNotice(page, 'Topic added.');
    };
    await addTopic(first);
    await addTopic(second);

    const table = page.getByRole('table');
    await expect(table.getByRole('row').filter({ hasText: first })).toContainText(`${first} (vi)`);
    await expect(table.getByRole('row').filter({ hasText: second })).toBeVisible();

    // Reviewers do not manage topics.
    const reviewer = await accounts.staff('REVIEWER');
    const reviewerPage = await newBrowser();
    await signInStaff(reviewerPage, reviewer.email, reviewer.password);
    await reviewerPage.goto(adminSite('/topics'));
    await expect(reviewerPage.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});
