import { publicApi } from '../support/api';
import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { expectNotice, signIn } from '../support/pages/auth';

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
    await signIn(page, user.email, user.password);
    await page.goto('/staff/exam-packs');

    const form = page.getByRole('form', { name: 'New exam pack' });
    await form.getByLabel('Grade').selectOption({ label: `Grade ${grade}` });
    await form.getByLabel('Competition').selectOption({ label: competition.name });
    await form.getByLabel('Price (VND)').fill('499000');
    await form.getByLabel('Validity').selectOption({ label: '12 months' });
    await form.getByLabel('Status').selectOption({ label: 'On sale' });
    await form.getByRole('button', { name: 'Create pack' }).click();

    await expectNotice(page, 'Exam pack created.');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('On sale');
    await expect(row).toContainText('12 months');
    expect((await publicApi.examPacks()).map((p) => p.name)).toContain(name);

    // A draft pack is hidden from students and the public.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const editRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Save', exact: true }) });
    await editRow.getByLabel('Status').selectOption({ label: 'Draft' });
    await editRow.getByRole('button', { name: 'Save', exact: true }).click();
    await expectNotice(page, 'Exam pack updated.');
    await expect(row).toContainText('Draft');
    expect((await publicApi.examPacks()).map((p) => p.name)).not.toContain(name);
  });

  test('E2E-CAT-04 · Topics', async ({ page, newBrowser, accounts }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const shared = unique('Time');
    const asmoOnly = unique('Geometry');

    await signIn(page, creator.email, creator.password);
    await page.goto('/staff/topics');
    const form = page.getByRole('form', { name: 'Add a topic' });

    const addTopic = async (nameEn: string, competition: string) => {
      await form.getByLabel('Name (English)').fill(nameEn);
      await form.getByLabel('Name (Vietnamese)').fill(`${nameEn} (vi)`);
      await form.getByLabel('Competition').selectOption({ label: competition });
      await form.getByRole('button', { name: 'Add topic' }).click();
      await expectNotice(page, 'Topic added.');
    };
    await addTopic(shared, 'Shared (all competitions)');
    await addTopic(asmoOnly, 'ASMO');

    const table = page.getByRole('table');
    await expect(table.getByRole('row').filter({ hasText: shared })).toContainText('Shared');
    await expect(table.getByRole('row').filter({ hasText: asmoOnly })).toContainText('ASMO');

    const filter = page.getByLabel('Filter by competition');
    await filter.selectOption({ label: 'ASMO' });
    await expect(table).toContainText(asmoOnly);
    await expect(table).not.toContainText(shared);
    await filter.selectOption({ label: 'Shared (all competitions)' });
    await expect(table).toContainText(shared);
    await expect(table).not.toContainText(asmoOnly);

    // Reviewers do not manage topics.
    const reviewer = await accounts.staff('REVIEWER');
    const reviewerPage = await newBrowser();
    await signIn(reviewerPage, reviewer.email, reviewer.password);
    await reviewerPage.goto('/staff/topics');
    await expect(reviewerPage.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});
