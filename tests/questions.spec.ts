import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { expectNotice, signIn } from '../support/pages/auth';
import { LABELS, QuestionEditor, statusBadge, textQuestion } from '../support/pages/questions';

const IMG = {
  clock: 'assets/clock.png',
  photo: 'assets/photo.jpg',
  three: 'assets/three-dots.png',
  two: 'assets/two-dots.png',
};

type Content = 'text-only' | 'image-only' | 'mixed';

// Phase 2 acceptance criterion 1 (a subset of the 9 combinations; all 9 run in regression).
const VARIANTS: [Content, number][] = [
  ['text-only', 4],
  ['image-only', 2],
  ['mixed', 6],
];

test.describe('Question bank', { tag: '@smoke' }, () => {
  for (const [content, choices] of VARIANTS) {
    test(`E2E-QB-01 · Create a ${content} question with ${choices} choices`, async ({
      page,
      accounts,
      asmoPack,
      newTopic,
    }) => {
      const creator = await accounts.staff('CONTENT_CREATOR');
      const topic = await newTopic();
      const prompt = `${unique('What time is it')}?`;
      const editor = new QuestionEditor(page);

      await signIn(page, creator.email, creator.password);
      await page.goto('/staff/questions');
      await page.getByRole('link', { name: 'New question' }).click();
      await expect(page.getByRole('heading', { name: 'New question' })).toBeVisible();

      await editor.classify({ pack: asmoPack.name, topics: [topic.nameEn] });
      if (content !== 'image-only') await page.getByLabel('Question (English)').fill(prompt);
      if (content !== 'text-only') {
        await editor.upload('Illustration', content === 'mixed' ? IMG.photo : IMG.clock);
        await expect(page.getByText(/^Optimized: .+ → .+$/).first()).toBeVisible();
      }

      await editor.choiceCount(choices);
      for (const label of LABELS.slice(0, choices)) {
        // Image-only and mixed questions get an image answer as choice A.
        if (label === 'A' && content !== 'text-only') {
          await editor.upload('Image for answer A', IMG.three);
        } else {
          await page.getByLabel(`Answer ${label} (English)`).fill(`${label} answer`);
        }
      }
      await editor.markCorrect('B');

      const preview = page.getByRole('region', { name: 'Preview' });
      await expect(preview.getByRole('listitem')).toHaveCount(choices);
      await expect(preview.getByRole('listitem').nth(1)).toContainText('Correct');

      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page).toHaveURL(/\/staff\/questions\/[0-9a-f-]{36}$/);
      await expectNotice(page, 'Question saved as a draft.');
      await expect(statusBadge(page)).toHaveText('Draft');

      const id = page.url().split('/').pop()!;
      const saved = await creator.api.getQuestion(id);
      expect(saved.status).toBe('DRAFT');
      expect(saved.answerChoices).toHaveLength(choices);
      expect(saved.answerChoices.find((c) => c.isCorrect)?.label).toBe('B');
      expect(saved.promptTextEn).toBe(content === 'image-only' ? null : prompt);
      if (content !== 'text-only') {
        // Stored under a content hash and served by the app (a CDN in production).
        expect(saved.promptImageUrl).toMatch(
          /\/api\/v1\/media\/questions\/[0-9a-f]{16,}\.(png|jpg)$/,
        );
        const image = await page.request.get(saved.promptImageUrl!);
        expect(image.ok()).toBe(true);
        expect(image.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(saved.answerChoices[0]?.contentImageUrl).toMatch(/\.png$/);
      }
    });
  }

  test('E2E-QB-06 · Search and filter the bank', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const word = unique('fruit').replace(/-/g, '');
    const create = (text: string, o: Parameters<typeof textQuestion>[3]) =>
      creator.api.createQuestion(textQuestion(asmoPack.id, [topic.id], `${word} ${text}`, o));
    await create('apples', { difficulty: 'EASY' });
    await create('pears', { difficulty: 'MEDIUM' });
    await create('plums', { difficulty: 'HARD', languageMode: 'EN_VI' });

    await signIn(page, creator.email, creator.password);
    await page.goto('/staff/questions');
    const results = page.getByRole('table');
    // Filters live in the URL: click, then wait for the new state.
    await page.getByLabel('Only my questions').click();
    await expect(page.getByLabel('Only my questions')).toBeChecked();
    await expect(page.getByText('3 questions')).toBeVisible();

    await page.getByLabel('Difficulty').selectOption({ label: 'Medium' });
    await expect(page).toHaveURL(/difficulty=MEDIUM/);
    await expect(page.getByText('1 question', { exact: true })).toBeVisible();
    await expect(results).toContainText(`${word} pears`);
    await page.reload();
    await expect(results).toContainText(`${word} pears`);
    await expect(results).not.toContainText(`${word} apples`);

    await page.getByLabel('Difficulty').selectOption({ label: 'All' });
    const language = page.getByRole('combobox', { name: 'Language' });
    await language.selectOption({ label: 'English + Vietnamese' });
    await expect(page.getByText('1 question', { exact: true })).toBeVisible();
    await expect(results).toContainText(`${word} plums`);

    await language.selectOption({ label: 'All' });
    await page.getByLabel('Only my questions').click();
    await expect(page.getByLabel('Only my questions')).not.toBeChecked();
    await page.getByLabel('Topic').selectOption({ label: topic.nameEn });
    await page.getByRole('searchbox', { name: 'Search' }).fill('apples');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/q=apples/);
    await expect(page.getByText('1 question', { exact: true })).toBeVisible();
    await expect(results).toContainText(`${word} apples`);
  });
});
