import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { adminSite, signInStaff } from '../support/pages/auth';
import { QuestionEditor, statusBadge, textQuestion } from '../support/pages/questions';

// E2E-QB-11 · The explanation of a question (Phase 5). The result of an exam that shows it is in student.spec.ts
// (E2E-ATT-01); the rules of the API are checked by the blackbox suite.

test.describe('The explanation of a question', () => {
  test('E2E-QB-11 · Written in two languages, previewed, refused when too long', async ({
    page,
    accounts,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const editor = new QuestionEditor(page);

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));
    await editor.classify({ topics: [topic.nameEn], language: 'English + Vietnamese' });
    await page.getByLabel('Question (English)').fill('What is 2 + 3?');
    await page.getByLabel('Question (Vietnamese)').fill('2 + 3 bằng mấy?');
    await editor.choiceCount(2);
    await page.getByLabel('Answer A (English)').fill('Four');
    await page.getByLabel('Answer A (Vietnamese)').fill('Bốn');
    await page.getByLabel('Answer B (English)').fill('Five');
    await page.getByLabel('Answer B (Vietnamese)').fill('Năm');
    await editor.markCorrect('B');

    // Both languages, next to each other and under the answers in the preview.
    await page.getByLabel('Explanation (English)').fill('$2 + 3 = 5$, so the answer is B.');
    await page.getByLabel('Explanation (Vietnamese)').fill('$2 + 3 = 5$, nên đáp án là B.');
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.getByRole('heading', { name: 'Explanation' })).toBeVisible();
    await expect(preview.locator('[lang="en"]', { hasText: 'so the answer is B' })).toBeVisible();
    await expect(preview.locator('[lang="vi"]', { hasText: 'nên đáp án là B' })).toBeVisible();

    // Pictures: several at once, in order, moved, removed, shown in the preview (up to 10).
    const pictures = page.getByLabel('Explanation pictures: Add pictures');
    await pictures.setInputFiles(['assets/two-dots.png', 'assets/three-dots.png']);
    await expect(page.getByText('2 of 10 pictures')).toBeVisible();
    await expect(preview.getByAltText(/^Explanation picture \d$/)).toHaveCount(2);
    await page.getByRole('button', { name: 'Move picture 2 earlier' }).click();
    await pictures.setInputFiles('assets/clock.png');
    await expect(page.getByText('3 of 10 pictures')).toBeVisible();
    await page.getByRole('button', { name: 'Remove picture 3' }).click();
    await expect(page.getByText('2 of 10 pictures')).toBeVisible();

    // Too long: refused with the reason, and nothing is saved.
    const reasonable = '$2 + 3 = 5$, so the answer is B.';
    await page.getByLabel('Explanation (English)').fill('a'.repeat(2001));
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('alert')).toContainText('an explanation is too long');
    await expect(page).toHaveURL(adminSite('/questions/new'));

    await page.getByLabel('Explanation (English)').fill(reasonable);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/questions\/[0-9a-fA-F-]{36}$/);
    const saved = await creator.api.getQuestion(page.url().split('/').pop()!);
    expect(saved.explanationEn).toBe(reasonable);
    expect(saved.explanationVi).toBe('$2 + 3 = 5$, nên đáp án là B.');
    expect(saved.explanationImageUrls).toHaveLength(2);
    expect(new Set(saved.explanationImageUrls).size).toBe(2);

    // Reopened, the pictures are still there, in order.
    await page.reload();
    await expect(page.getByText('2 of 10 pictures')).toBeVisible();
  });

  test('E2E-QB-11 · A bilingual question needs the Vietnamese explanation to be published', async ({
    page,
    accounts,
    newTopic,
  }) => {
    const [creator, reviewer] = await Promise.all([
      accounts.staff('CONTENT_CREATOR'),
      accounts.staff('REVIEWER'),
    ]);
    const topic = await newTopic();
    const q = await creator.api.createQuestion(
      textQuestion([topic.id], unique('What time is it'), {
        languageMode: 'EN_VI',
        promptTextVi: 'Mấy giờ rồi?',
        explanationEn: 'Read the short hand.',
        // Every answer is translated: the explanation is what is still missing.
        answerChoices: ['A', 'B'].map((label, i) => ({
          label,
          contentTextEn: `${i + 1} o'clock`,
          contentTextVi: `${i + 1} giờ`,
          contentImageUrl: null,
          isCorrect: i === 0,
        })),
      }),
    );
    await creator.api.act(q.id, 'submit-review');

    await signInStaff(page, reviewer.email, reviewer.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await expect(page.getByText(/still lacks Vietnamese text/)).toBeVisible();

    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'and the explanation before it can be published',
    );
    await expect(statusBadge(page)).toHaveText('Pending review');

    await page.getByLabel('Explanation (Vietnamese)').fill('Đọc kim ngắn.');
    await expect(page.getByText(/still lacks Vietnamese text/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(statusBadge(page)).toHaveText('Published');
    expect((await reviewer.api.getQuestion(q.id)).explanationVi).toBe('Đọc kim ngắn.');
  });
});
