import type { Page } from '@playwright/test';
import type { Account } from '../support/fixtures';
import type { Difficulty, ExamPack, Topic } from '../support/api';
import { unique } from '../support/data';
import { expect, test } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import { textQuestion } from '../support/pages/questions';

// Release Phase 4: mock exam blueprints and exam generation (E2E-BLP-01 to 06).
// The API checks every rule (the blackbox suite, BLP-01 to 07); these tests
// check what only the browser shows: the form with its live totals, the alert
// and the sample exam.

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

/** Publishes n questions of a difficulty in a topic (a creator writes, a reviewer approves). */
async function publish(
  creator: Account,
  reviewer: Account,
  pack: ExamPack,
  topic: Topic,
  difficulty: Difficulty,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const q = await creator.api.createQuestion(
      textQuestion(pack.id, [topic.id], unique(`${topic.nameEn} ${difficulty}`), { difficulty }),
    );
    await creator.api.act(q.id, 'submit-review');
    await reviewer.api.act(q.id, 'approve');
  }
}

async function openBlueprint(page: Page, name: string) {
  await page.goto(adminSite('/mock-exams'));
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test.describe('Mock exam blueprints', () => {
  test('E2E-BLP-01 · Create a blueprint', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const time = await newTopic();
    const geometry = await newTopic();
    const name = unique('Standard mock');

    await signInStaff(page, creator.email, creator.password);
    await page
      .getByRole('navigation', { name: 'Staff', exact: true })
      .getByRole('link', { name: 'Mock exams' })
      .click();
    await page.getByRole('link', { name: 'New blueprint' }).click();

    const form = page.getByRole('form', { name: 'New blueprint' });
    await form.getByLabel('Exam pack', { exact: true }).selectOption({ label: asmoPack.name });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Total questions', { exact: true }).fill('10');
    await form.getByLabel('Time limit (minutes)', { exact: true }).fill('30');

    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 1', { exact: true }).selectOption({ label: time.nameEn });
    await form.getByLabel('Questions 1', { exact: true }).fill('4');
    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 2', { exact: true }).selectOption({ label: geometry.nameEn });
    await form.getByLabel('Questions 2', { exact: true }).fill('6');
    await expect(form.getByText('10 of 10 questions').first()).toBeVisible();

    await form.getByLabel(/Set the number of questions and the points/).check();
    for (const [label, count, points] of [
      ['Easy', '5', '1'],
      ['Medium', '3', '2'],
      ['Hard', '2', '3'],
    ] as const) {
      await form.getByLabel(`${label}: Questions`, { exact: true }).fill(count);
      await form.getByLabel(`${label}: Points per question`, { exact: true }).fill(points);
    }
    await expect(form.getByText('Total points: 17')).toBeVisible();

    await form.getByRole('button', { name: 'Save' }).click();
    await expectNotice(page, 'Blueprint saved.');
    await expect(page).toHaveURL(/\/mock-exams\/[0-9a-f-]{36}$/);

    // It is listed as a draft, and opens again with every value.
    await page.goto(adminSite('/mock-exams'));
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Draft');
    await expect(row).toContainText('30 min');
    await expect(row).toContainText('17');

    await openBlueprint(page, name);
    const edit = page.getByRole('form', { name: 'Edit blueprint' });
    await expect(edit.getByLabel('Total questions', { exact: true })).toHaveValue('10');
    // The topics come back in the order they were entered.
    await expect(edit.getByLabel('Topic 1', { exact: true })).toHaveValue(time.id);
    await expect(edit.getByLabel('Topic 2', { exact: true })).toHaveValue(geometry.id);
    await expect(edit.getByLabel('Medium: Points per question', { exact: true })).toHaveValue('2');

    // Moving a topic changes the order, and it is kept.
    await expect(edit.getByRole('button', { name: 'Move topic 1 up' })).toBeDisabled();
    await expect(edit.getByRole('button', { name: 'Move topic 2 down' })).toBeDisabled();
    await edit.getByRole('button', { name: 'Move topic 1 down' }).click();
    await edit.getByRole('button', { name: 'Save' }).click();
    await expectNotice(page, 'Blueprint saved.');
    await page.reload();
    const moved = page.getByRole('form', { name: 'Edit blueprint' });
    await expect(moved.getByLabel('Topic 1', { exact: true })).toHaveValue(geometry.id);
    await expect(moved.getByLabel('Topic 2', { exact: true })).toHaveValue(time.id);
  });

  test('E2E-BLP-02 · The distributions must add up', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const time = await newTopic();
    const geometry = await newTopic();

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/mock-exams/new'));
    const form = page.getByRole('form', { name: 'New blueprint' });
    const save = form.getByRole('button', { name: 'Save' });

    await form.getByLabel('Exam pack', { exact: true }).selectOption({ label: asmoPack.name });
    await form.getByLabel('Name', { exact: true }).fill(unique('Short'));
    await form.getByLabel('Total questions', { exact: true }).fill('10');
    await form.getByLabel('Time limit (minutes)', { exact: true }).fill('30');
    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 1', { exact: true }).selectOption({ label: time.nameEn });
    await form.getByLabel('Questions 1', { exact: true }).fill('4');
    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 2', { exact: true }).selectOption({ label: geometry.nameEn });
    await form.getByLabel('Questions 2', { exact: true }).fill('5');

    await expect(form.getByText('9 of 10 questions').first()).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(form.getByText('The topic counts must add up to the total.')).toBeVisible();

    // A topic can be chosen once: it is gone from the other line's choices.
    await expect(
      form.getByLabel('Topic 2', { exact: true }).locator('option', { hasText: time.nameEn }),
    ).toHaveCount(0);

    await form.getByLabel('Questions 2', { exact: true }).fill('6');
    await expect(save).toBeEnabled();

    await form.getByLabel(/Set the number of questions and the points/).check();
    await expect(save).toBeDisabled();
    await form.getByLabel('Easy: Questions', { exact: true }).fill('5');
    await form.getByLabel('Medium: Questions', { exact: true }).fill('3');
    await form.getByLabel('Hard: Questions', { exact: true }).fill('0');
    await expect(form.getByText('8 of 10 questions').first()).toBeVisible();
    await expect(form.getByText('The difficulty counts must add up to the total.')).toBeVisible();
    await form.getByLabel('Hard: Questions', { exact: true }).fill('2');
    await form.getByLabel('Hard: Points per question', { exact: true }).fill('0');
    await expect(save).toBeDisabled();
    await form.getByLabel('Hard: Points per question', { exact: true }).fill('3');
    await expect(save).toBeEnabled();

    await form.getByLabel('Total questions', { exact: true }).fill('101');
    await expect(
      form.getByText('Total questions must be a whole number from 1 to 100.'),
    ).toBeVisible();
    await form.getByLabel('Total questions', { exact: true }).fill('10');
    await form.getByLabel('Time limit (minutes)', { exact: true }).fill('301');
    await expect(form.getByText('The time limit must be from 1 to 300 minutes.')).toBeVisible();
    await form.getByLabel('Time limit (minutes)', { exact: true }).fill('30');
    await form.getByLabel('Name', { exact: true }).fill('');
    await expect(form.getByText('Enter a name.')).toBeVisible();
  });

  test('E2E-BLP-04 · The alert when the bank is short', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const time = await newTopic();
    const geometry = await newTopic();
    const blueprint = await creator.api.createBlueprint({
      examPackId: asmoPack.id,
      name: unique('Alert mock'),
      totalQuestions: 4,
      timeLimitMinutes: 20,
      topicDistribution: [
        { topicId: time.id, count: 2 },
        { topicId: geometry.id, count: 2 },
      ],
    });

    await publish(creator, reviewer, asmoPack, time, 'EASY', 2);
    await publish(creator, reviewer, asmoPack, geometry, 'EASY', 1);

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/mock-exams'));
    await expect(page.getByRole('row').filter({ hasText: blueprint.name })).toContainText(
      'Not enough questions',
    );

    await openBlueprint(page, blueprint.name);
    const panel = page.getByRole('region', { name: 'Question bank' });
    await expect(panel.getByRole('alert')).toContainText(
      `Topic ${geometry.nameEn}: needs 2, has 1`,
    );
    await expect(panel.getByRole('alert')).not.toContainText(time.nameEn);

    // The same alert for a reviewer, who can read the blueprint.
    const other = await page.context().browser()!.newContext();
    const reviewerPage = await other.newPage();
    await reviewerPage.addInitScript(() => window.localStorage.setItem('vietmath.lang', 'en'));
    await signInStaff(reviewerPage, reviewer.email, reviewer.password);
    await reviewerPage.goto(adminSite('/mock-exams'));
    await expect(reviewerPage.getByRole('row').filter({ hasText: blueprint.name })).toContainText(
      'Not enough questions',
    );
    await other.close();

    // Publishing the missing question makes the alert go away by itself.
    await publish(creator, reviewer, asmoPack, geometry, 'EASY', 1);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Question bank' })).toContainText(
      'Ready: the published questions can fill this blueprint.',
    );
    await page.goto(adminSite('/mock-exams'));
    await expect(page.getByRole('row').filter({ hasText: blueprint.name })).toContainText('Ready');
  });

  test('E2E-BLP-05 · Generate a sample exam', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const time = await newTopic();
    const geometry = await newTopic();
    const blueprint = await creator.api.createBlueprint({
      examPackId: asmoPack.id,
      name: unique('Sample mock'),
      totalQuestions: 6,
      timeLimitMinutes: 20,
      topicDistribution: [
        { topicId: time.id, count: 2 },
        { topicId: geometry.id, count: 4 },
      ],
      difficultyDistribution: [
        { difficulty: 'EASY', count: 3, points: 1 },
        { difficulty: 'MEDIUM', count: 2, points: 2 },
        { difficulty: 'HARD', count: 1, points: 3 },
      ],
    });

    for (const topic of [time, geometry]) {
      for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
        await publish(creator, reviewer, asmoPack, topic, difficulty, 4);
      }
    }

    await signInStaff(page, creator.email, creator.password);
    await openBlueprint(page, blueprint.name);

    const panel = page.getByRole('region', { name: 'Sample exam' });
    const generate = panel.getByRole('button', { name: 'Generate sample exam' });
    const questions = panel.locator('ol > li');
    const seen = new Set<string>();

    for (let run = 0; run < 3; run++) {
      await generate.click();
      await expect(questions).toHaveCount(6);
      await expect(panel).toContainText('6 questions · 20 min · 10 points');

      // The counts are met together, and no question appears twice.
      await expect(panel.getByText(new RegExp(`^${time.nameEn} · `))).toHaveCount(2);
      await expect(panel.getByText(new RegExp(`^${geometry.nameEn} · `))).toHaveCount(4);
      for (const [difficulty, n] of [
        ['EASY', 3],
        ['MEDIUM', 2],
        ['HARD', 1],
      ] as const) {
        await expect(
          panel.getByText(new RegExp(` · ${DIFFICULTY_LABEL[difficulty]} · `)),
        ).toHaveCount(n);
      }
      const prompts = await questions.locator('p.mt-2').allTextContents();
      expect(new Set(prompts).size).toBe(6);
      await expect(questions.first()).toContainText('✓ Answer');
      seen.add(prompts.join('|'));

      // The exam follows the blueprint's topics: Time first, then Geometry.
      for (const [i, topic] of [time, time, geometry, geometry, geometry, geometry].entries()) {
        await expect(questions.nth(i)).toContainText(topic.nameEn);
      }
    }

    expect(seen.size, 'two generations differ').toBeGreaterThan(1);

    // Move Geometry first, save, and the next exam lists it first.
    const edit = page.getByRole('form', { name: 'Edit blueprint' });
    await edit.getByRole('button', { name: 'Move topic 2 up' }).click();
    await edit.getByRole('button', { name: 'Save' }).click();
    await expectNotice(page, 'Blueprint saved.');
    await generate.click();
    await expect(questions).toHaveCount(6);
    for (const [i, topic] of [geometry, geometry, geometry, geometry, time, time].entries()) {
      await expect(questions.nth(i)).toContainText(topic.nameEn);
    }

    // Nothing is stored: a reload shows no sample.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Sample exam' }).locator('ol > li')).toHaveCount(
      0,
    );
  });

  test('E2E-BLP-06 · Not enough questions: no exam, a clear message', async ({
    page,
    accounts,
    asmoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const time = await newTopic();
    const blueprint = await creator.api.createBlueprint({
      examPackId: asmoPack.id,
      name: unique('Short mock'),
      totalQuestions: 3,
      timeLimitMinutes: 15,
      topicDistribution: [{ topicId: time.id, count: 3 }],
    });
    await publish(creator, reviewer, asmoPack, time, 'EASY', 1);

    await signInStaff(page, creator.email, creator.password);
    await openBlueprint(page, blueprint.name);

    const panel = page.getByRole('region', { name: 'Sample exam' });
    await panel.getByRole('button', { name: 'Generate sample exam' }).click();
    await expect(panel.getByRole('alert')).toContainText('An exam could not be generated:');
    await expect(panel.getByRole('alert')).toContainText(`Topic ${time.nameEn}: needs 3, has 1`);
    await expect(panel.locator('ol > li')).toHaveCount(0);

    // Once the bank is filled, the same blueprint generates.
    await publish(creator, reviewer, asmoPack, time, 'EASY', 2);
    await panel.getByRole('button', { name: 'Generate sample exam' }).click();
    await expect(panel.locator('ol > li')).toHaveCount(3);
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
});
