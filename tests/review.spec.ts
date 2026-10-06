import type { Question } from '../support/api';
import { unique } from '../support/data';
import { expect, test, type Account } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import { statusBadge, textQuestion } from '../support/pages/questions';

test.describe('Review workflow', { tag: '@smoke' }, () => {
  let creator: Account;
  let reviewer: Account;
  let topicId: string;

  test.beforeEach(async ({ accounts, newTopic }) => {
    [creator, reviewer] = await Promise.all([
      accounts.staff('CONTENT_CREATOR'),
      accounts.staff('REVIEWER'),
    ]);
    topicId = (await newTopic()).id;
  });

  const history = (page: import('@playwright/test').Page) =>
    page.getByRole('region', { name: 'Review history' });

  test('E2E-RW-01 · Submit and publish', async ({ page, newBrowser, asmoPack }) => {
    const prompt = unique('How many sides does a triangle have');
    const q = await creator.api.createQuestion(textQuestion(asmoPack.id, [topicId], prompt));

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expectNotice(page, 'Submitted for review.');
    await expect(statusBadge(page)).toHaveText('Pending review');
    await expect(page.getByText(/This question is with the reviewers/)).toBeVisible();
    await expect(page.getByLabel('Question (English)')).toHaveCount(0);

    const rp = await newBrowser();
    await signInStaff(rp, reviewer.email, reviewer.password);
    await rp
      .getByRole('navigation', { name: 'Staff', exact: true })
      .getByRole('link', { name: 'Review queue' })
      .click();
    await rp.getByRole('link', { name: prompt }).click();
    await rp.getByRole('button', { name: 'Approve and publish' }).click();
    await expectNotice(rp, 'Published.');
    await expect(statusBadge(rp)).toHaveText('Published');
    await expect(history(rp)).toContainText('Submitted for review');
    await expect(history(rp)).toContainText('Approved and published');

    await rp.goto(adminSite('/review'));
    await expect(rp.getByRole('link', { name: prompt })).toHaveCount(0);
  });

  /** A bilingual question with English text only, waiting for review. */
  async function pendingWithoutVietnamese(examPackId: string): Promise<Question> {
    const q = await creator.api.createQuestion(
      textQuestion(examPackId, [topicId], unique('What time is it'), { languageMode: 'EN_VI' }),
    );
    return creator.api.act(q.id, 'submit-review');
  }

  test('E2E-RW-03 · A bilingual question cannot be published without Vietnamese', async ({
    page,
    asmoPack,
  }) => {
    const q = await pendingWithoutVietnamese(asmoPack.id);

    await signInStaff(page, reviewer.email, reviewer.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await expect(
      page.getByText(/You can edit this question directly before approving it/),
    ).toBeVisible();
    await expect(page.getByText(/still lacks Vietnamese text/)).toBeVisible();

    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'A bilingual question needs Vietnamese text for the question and every text answer before it can be published.',
    );
    await expect(statusBadge(page)).toHaveText('Pending review');
    expect((await reviewer.api.getQuestion(q.id)).status).toBe('PENDING_REVIEW');
  });

  test('E2E-RW-04 · The reviewer edits and publishes in one action', async ({ page, asmoPack }) => {
    const q = await pendingWithoutVietnamese(asmoPack.id);
    const fixedPrompt = `${q.promptTextEn} (edited)`;

    await signInStaff(page, reviewer.email, reviewer.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await page.getByLabel('Question (English)').fill(fixedPrompt);
    await page.getByLabel('Question (Vietnamese)').fill('Bây giờ là mấy giờ?');
    for (const [i, label] of ['A', 'B', 'C', 'D'].entries()) {
      await page.getByLabel(`Answer ${label} (Vietnamese)`).fill(`${i + 1} giờ`);
    }
    await page.getByRole('button', { name: 'Approve and publish' }).click();

    await expectNotice(page, 'Published.');
    await expect(history(page)).toContainText('Edited by the reviewer');
    await expect(history(page)).toContainText('Approved and published');

    const saved = await creator.api.getQuestion(q.id);
    expect(saved.status).toBe('PUBLISHED');
    expect(saved.promptTextEn).toBe(fixedPrompt);
    expect(saved.promptTextVi).toBe('Bây giờ là mấy giờ?');
    expect(saved.answerChoices.map((c) => c.contentTextVi)).toEqual([
      '1 giờ',
      '2 giờ',
      '3 giờ',
      '4 giờ',
    ]);
  });

  test('E2E-RW-07 · Archived questions leave default search results', async ({
    page,
    asmoPack,
  }) => {
    const prompt = unique('Which shape is round');
    const q = await creator.api.createQuestion(textQuestion(asmoPack.id, [topicId], prompt));
    await creator.api.act(q.id, 'submit-review');
    await reviewer.api.act(q.id, 'approve');

    await signInStaff(page, reviewer.email, reviewer.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await page.getByRole('button', { name: 'Archive' }).click();
    await expectNotice(page, 'Archived.');
    await expect(statusBadge(page)).toHaveText('Archived');

    const search = async () => {
      await page.getByRole('searchbox', { name: 'Search' }).fill(prompt);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
    };
    await page.goto(adminSite('/questions'));
    await search();
    await expect(page.getByText('No questions match the filters.')).toBeVisible();

    await page.getByLabel('Status').selectOption({ label: 'Archived' });
    await expect(page.getByRole('link', { name: prompt })).toBeVisible();
    await page.getByRole('link', { name: prompt }).click();
    await expect(page.getByRole('button', { name: 'Restore to draft' })).toBeVisible();
  });
});
