import { readFileSync } from 'node:fs';
import { type Locator, type Page } from '@playwright/test';
import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import { QuestionEditor, statusBadge, textQuestion } from '../support/pages/questions';

/** Puts a picture on the "clipboard" and pastes it into an element, as a screenshot would be. */
async function pasteImage(target: Locator, path: string) {
  const base64 = readFileSync(path).toString('base64');
  await target.evaluate(async (el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, base64);
}

/** Drops a picture file onto an element, as dragging it from the file manager would. */
async function dropImage(target: Locator, path: string) {
  const base64 = readFileSync(path).toString('base64');
  await target.evaluate(async (el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'diagram.png', { type: 'image/png' }));
    el.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, base64);
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Quick insert' });

test.describe('Authoring a question', () => {
  test('E2E-QB-03 · Bilingual questions are shown side by side', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const editor = new QuestionEditor(page);

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));

    // English + Vietnamese is the default: every text field has a Vietnamese twin.
    await expect(
      page.getByText('Vietnamese text is required before the question can be published.'),
    ).toBeVisible();
    await editor.classify({
      pack: asmoPack.name,
      topics: [topic.nameEn],
      language: 'English + Vietnamese',
    });
    await page.getByLabel('Question (English)').fill('What time is it?');
    await page.getByLabel('Question (Vietnamese)').fill('Mấy giờ rồi?');
    await editor.choiceCount(2);
    await page.getByLabel('Answer A (English)').fill('Three');
    await page.getByLabel('Answer A (Vietnamese)').fill('Ba');
    await page.getByLabel('Answer B (English)').fill('Four');
    await page.getByLabel('Answer B (Vietnamese)').fill('Bốn');

    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.locator('[lang="en"]', { hasText: 'What time is it?' })).toBeVisible();
    await expect(preview.locator('[lang="vi"]', { hasText: 'Mấy giờ rồi?' })).toBeVisible();
    await expect(preview.locator('[lang="vi"]', { hasText: 'Ba' })).toBeVisible();

    // English only: the Vietnamese text is not kept.
    await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'English' });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]{36}$/);
    const saved = await creator.api.getQuestion(page.url().split('/').pop()!);
    expect(saved.languageMode).toBe('EN');
    expect(saved.promptTextVi).toBeNull();

    await page
      .getByRole('combobox', { name: 'Language' })
      .selectOption({ label: 'English + Vietnamese' });
    await expect(page.getByLabel('Question (Vietnamese)')).toHaveValue('');
  });

  test('E2E-QB-09 · Math in question and answer text', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const editor = new QuestionEditor(page);
    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));
    await editor.classify({ pack: asmoPack.name, topics: [topic.nameEn] });

    const prompt = page.getByLabel('Question (English)');
    await expect(toolbar(page)).toHaveCount(0); // the buttons show while a field has focus
    await prompt.click();
    await prompt.fill('Half of 8 is ');
    await toolbar(page).getByRole('button', { name: 'Insert fraction' }).click();
    await expect(prompt).toHaveValue('Half of 8 is $\\frac{}{}$');
    await page.keyboard.type('1');

    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.locator('.katex')).toHaveCount(1);

    // A selection is wrapped, and inside math no second pair of dollar signs is added.
    await prompt.fill('Find 16 now');
    await prompt.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 7));
    await toolbar(page).getByRole('button', { name: 'Insert square root' }).click();
    await expect(prompt).toHaveValue('Find $\\sqrt{16}$ now');
    await toolbar(page).getByRole('button', { name: 'Insert multiplication sign' }).click();
    expect(((await prompt.inputValue()).match(/\$/g) ?? []).length).toBe(2);

    // Answers take math too; a plain dollar sign is written \$.
    await editor.choiceCount(2);
    await page.getByLabel('Answer A (English)').fill('$x^2$');
    await page.getByLabel('Answer B (English)').fill('It costs \\$5 and \\$6');
    await expect(preview.locator('.katex')).toHaveCount(2);
    await expect(preview).toContainText('It costs $5 and $6');

    // A mistake in the LaTeX shows in red and does not stop saving.
    await prompt.fill('Broken $\\frac{1$ here');
    await expect(preview.locator('.katex-error')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]{36}$/);
  });

  test('E2E-QB-10 · Add an image by dragging or pasting', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const editor = new QuestionEditor(page);
    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));
    await editor.classify({ pack: asmoPack.name, topics: [topic.nameEn] });

    // A picture dropped on the illustration's box.
    await dropImage(page.getByTestId('image-dropzone').first(), 'assets/clock.png');
    await expect(page.getByText(/^Optimized: .+ → .+$/).first()).toBeVisible();
    await expect(page.getByLabel('Illustration: Replace image')).toBeAttached();

    // A screenshot pasted into an answer's box.
    await page.getByLabel('Number of answer choices').selectOption('2');
    const answerBox = page
      .getByTestId('image-dropzone')
      .filter({ has: page.getByLabel('Image for answer B: Add image') });
    await pasteImage(answerBox, 'assets/three-dots.png');
    await expect(page.getByLabel('Image for answer B: Replace image')).toBeAttached({
      timeout: 20_000,
    });

    // A screenshot pasted while typing the question replaces the illustration; the text stays.
    await page.getByRole('button', { name: 'Remove image' }).first().click();
    const prompt = page.getByLabel('Question (English)');
    await prompt.fill('What time is it?');
    await pasteImage(prompt, 'assets/two-dots.png');
    await expect(page.getByLabel('Illustration: Replace image')).toBeAttached({ timeout: 20_000 });
    await expect(prompt).toHaveValue('What time is it?');

    // A file that is not an image is refused with a message.
    await page
      .getByTestId('image-dropzone')
      .first()
      .evaluate((el) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
        el.dispatchEvent(
          new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      });
    await expect(page.getByText('Only PNG, JPEG, GIF or WebP images can be added.')).toBeVisible();
  });

  test('E2E-PAR-08 · Insert buttons and math in a template', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const editor = new QuestionEditor(page);
    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));
    await editor.classify({ pack: asmoPack.name, topics: [topic.nameEn], language: 'English' });
    await page.getByLabel(/Template: generate variants/).check();

    const prompt = page.getByLabel('Question (English)');
    await prompt.click();
    await expect(toolbar(page).getByRole('button', { name: 'Insert variable a' })).toBeVisible();
    await prompt.fill('A store has ');
    await toolbar(page).getByRole('button', { name: 'Insert variable a' }).click();
    await expect(prompt).toHaveValue('A store has {a}');

    // In a template the braces of a formula are doubled, so that a variable fits inside.
    await prompt.fill('');
    await toolbar(page).getByRole('button', { name: 'Insert fraction' }).click();
    await expect(prompt).toHaveValue('$\\frac{{}}{{}}$');
    await toolbar(page).getByRole('button', { name: 'Insert variable a' }).click();
    await expect(prompt).toHaveValue('$\\frac{{{a}}}{{}}$');

    // Constraints and answers suggest variables and functions.
    await page.getByRole('button', { name: 'Add constraint' }).click();
    const constraint = page.getByLabel('Constraint 1', { exact: true });
    await constraint.click();
    await expect(toolbar(page)).toHaveCount(1); // the previous field's buttons go once the click is done
    await toolbar(page).getByRole('button', { name: 'Insert variable a' }).click();
    await constraint.pressSequentially(' > ');
    await toolbar(page).getByRole('button', { name: 'Insert function max' }).click();
    await expect(constraint).toHaveValue('a > max()');

    const formula = page.getByLabel('Answer A formula');
    await formula.click();
    await expect(toolbar(page)).toHaveCount(1);
    await toolbar(page).getByRole('button', { name: 'Insert function abs' }).click();
    await expect(formula).toHaveValue('abs()');
  });

  test('E2E-RW-02 · Unsaved edits go with the submission', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const q = await creator.api.createQuestion(
      textQuestion(asmoPack.id, [topic.id], unique('How many sides does a square have')),
    );

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite(`/questions/${q.id}`));
    await page.getByLabel('Difficulty').selectOption({ label: 'Hard' });
    await page.getByRole('button', { name: 'Submit for review' }).click();

    await expectNotice(page, 'Submitted for review.');
    await expect(statusBadge(page)).toHaveText('Pending review');
    expect((await creator.api.getQuestion(q.id)).difficulty).toBe('HARD');
  });
});
