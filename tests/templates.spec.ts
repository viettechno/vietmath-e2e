import type { Page } from '@playwright/test';
import { ApiError, type QuestionTemplate, type TemplateVariant } from '../support/api';
import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { expectNotice, signIn } from '../support/pages/auth';
import { QuestionEditor, statusBadge, textQuestion } from '../support/pages/questions';

// Release Phase 3: the Parametrization Engine (templates for mock questions).

const applesTemplate = (): QuestionTemplate => ({
  variables: [
    { varName: 'a', varType: 'INT', minValue: 5, maxValue: 20 },
    { varName: 'b', varType: 'INT', minValue: 1, maxValue: 4 },
  ],
  constraints: ['b < a'],
  correctAnswerFormula: 'a - b',
  distractorFormulas: ['a + b', 'a - b - 1', 'a - b + 10'],
});

/** Fills the template part of the question editor: variables a and b, b < a. */
async function fillApplesTemplate(page: Page, prompt: string, constraint = 'b < a') {
  await page.getByLabel(/Template: generate variants/).check();

  const a = page.getByRole('group', { name: 'Variable 1' });
  await a.getByLabel('Minimum').fill('5');
  await a.getByLabel('Maximum').fill('20');

  await page.getByRole('button', { name: 'Add variable' }).click();
  const b = page.getByRole('group', { name: 'Variable 2' });
  await expect(b.getByLabel('Name')).toHaveValue('b');
  await b.getByLabel('Minimum').fill('1');
  await b.getByLabel('Maximum').fill('4');

  await page.getByRole('button', { name: 'Add constraint' }).click();
  await page.getByRole('textbox', { name: 'Constraint 1' }).fill(constraint);

  await page.getByLabel('Question (English)').fill(prompt);
  for (const [label, formula] of [
    ['A', 'a - b'],
    ['B', 'a + b'],
    ['C', 'a - b - 1'],
    ['D', 'a - b + 10'],
  ] as const) {
    await page.getByLabel(`Answer ${label} formula`).fill(formula);
  }
}

/** Distinct values, b < a, the answer is a - b and no distractor equals it. */
function expectValidVariants(variants: TemplateVariant[]) {
  expect(variants).toHaveLength(5);
  const keys = variants.map((v) => `${v.values.a}/${v.values.b}`);
  expect(new Set(keys).size, 'variants are distinct').toBe(5);

  for (const v of variants) {
    const a = v.values.a!;
    const b = v.values.b!;
    expect(b).toBeLessThan(a);
    expect(v.correctAnswer.en).toBe(String(a - b));
    for (const d of v.distractors) expect(d.en).not.toBe(v.correctAnswer.en);
  }
}

test.describe('Question templates', { tag: '@smoke' }, () => {
  test('E2E-PAR-01 · Define a template, preview 5 variants, save it', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const marker = unique('apples');
    const prompt = `A store has {a} apples and sells {b} of them. How many are left? (${marker})`;

    await signIn(page, creator.email, creator.password);
    await page.goto('/staff/questions/new');
    await new QuestionEditor(page).classify({ pack: asmoPack.name, topics: [topic.nameEn] });
    await fillApplesTemplate(page, prompt);

    // The image inputs are gone: a template's answers are formulas.
    await expect(page.getByLabel('Image for answer A: Add image')).toHaveCount(0);

    // Preview 5 variants, twice: distinct and valid every time.
    const panel = page.getByRole('region', { name: 'Variants' });
    for (let run = 0; run < 2; run++) {
      const response = page.waitForResponse('**/api/v1/templates/preview');
      await panel.getByRole('button', { name: 'Preview 5 variants' }).click();
      const { variants } = (await (await response).json()) as { variants: TemplateVariant[] };
      expectValidVariants(variants);

      await expect(panel.getByRole('heading', { name: /^Variant \d$/ })).toHaveCount(5);
      const first = variants[0]!;
      await expect(panel).toContainText(
        `A store has ${first.values.a} apples and sells ${first.values.b} of them.`,
      );
    }

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expectNotice(page, 'Question saved as a draft.');
    await expect(statusBadge(page)).toHaveText('Draft');

    const saved = await creator.api.getQuestion(page.url().split('/').pop()!);
    expect(saved.isTemplate).toBe(true);
    expect(saved.template).toMatchObject(applesTemplate() as unknown as Record<string, unknown>);
    expect(saved.answerChoices.map((c) => c.contentTextEn)).toEqual([
      '{a - b}',
      '{a + b}',
      '{a - b - 1}',
      '{a - b + 10}',
    ]);

    // Reloaded, the editor shows the template again.
    await page.reload();
    await expect(page.getByLabel('Answer B formula')).toHaveValue('a + b');
    await expect(page.getByRole('textbox', { name: 'Constraint 1' })).toHaveValue('b < a');
  });

  test('E2E-PAR-02 · An unsatisfiable template is refused with a clear error', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();

    await signIn(page, creator.email, creator.password);
    await page.goto('/staff/questions/new');
    await new QuestionEditor(page).classify({ pack: asmoPack.name, topics: [topic.nameEn] });
    // a is at least 5 and b at most 4: "a < b" never holds.
    await fillApplesTemplate(page, `{a} apples, {b} sold (${unique('never')})`, 'a < b');

    const panel = page.getByRole('region', { name: 'Variants' });
    await panel.getByRole('button', { name: 'Preview 5 variants' }).click();
    await expect(panel.getByRole('alert')).toContainText('no valid variant found');

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('alert').last()).toContainText(
      'no valid variant found: the constraints are (almost) never all true',
    );
    await expect(page).toHaveURL('/staff/questions/new');

    // A formula error names the field it is in.
    await page.getByRole('textbox', { name: 'Constraint 1' }).fill('a <');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('alert').last()).toHaveText(
      'a formula has a syntax error (constraint 1)',
    );
  });

  test('E2E-PAR-03 · A question with image answer choices cannot be a template', async ({
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const topic = await newTopic();
    const image = await creator.api.uploadImage('assets/three-dots.png', 'image/png');
    const input = textQuestion(asmoPack.id, [topic.id], `{a} and {b} (${unique('img')})`);
    input.answerChoices[1] = {
      ...input.answerChoices[1]!,
      contentTextEn: null,
      contentImageUrl: image.url,
    };

    const error = await creator.api
      .createQuestion({ ...input, isTemplate: true, template: applesTemplate() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    expect(String(error)).toContain('questions with image answer choices cannot be templates');
  });

  test('E2E-PAR-04 · A reviewer previews a template and publishes it', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const [creator, reviewer] = await Promise.all([
      accounts.staff('CONTENT_CREATOR'),
      accounts.staff('REVIEWER'),
    ]);
    const topic = await newTopic();
    const q = await creator.api.createQuestion({
      ...textQuestion(asmoPack.id, [topic.id], `{a} apples, {b} sold (${unique('review')})`),
      isTemplate: true,
      template: applesTemplate(),
    });
    await creator.api.act(q.id, 'submit-review');

    await signIn(page, reviewer.email, reviewer.password);
    await page.goto(`/staff/questions/${q.id}`);
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview).toContainText('a: Whole number, 5 to 20');
    await expect(preview).toContainText('{a - b}');

    const panel = page.getByRole('region', { name: 'Variants' });
    await panel.getByRole('button', { name: 'Preview 5 variants' }).click();
    await expect(panel.getByRole('heading', { name: /^Variant \d$/ })).toHaveCount(5);

    // The reviewer fixes a distractor while approving.
    await page.getByLabel('Answer C formula').fill('a - b + 1');
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expectNotice(page, 'Published.');
    await expect(statusBadge(page)).toHaveText('Published');

    const published = await reviewer.api.getQuestion(q.id);
    expect(published.template?.distractorFormulas).toEqual(['a + b', 'a - b + 1', 'a - b + 10']);
  });
});
