import type { Page } from '@playwright/test';
import { ApiError, type Difficulty, type Topic } from '../support/api';
import { unique } from '../support/data';
import type { Account } from '../support/fixtures';
import { expect, test } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import { textQuestion } from '../support/pages/questions';

// Release Phase 4.6: the shared question bank (a question and a topic have nothing to do with a
// competition), the topic tree and its management, and blueprints in several exam packs
// (E2E-CAT-05, E2E-CAT-06, E2E-BLP-09, E2E-BLP-10). The API checks every rule (the blackbox
// suite); these tests check what only the browser shows: the parent field, the indented lists,
// the edit and delete of a topic, the pack tick list and the disabled topics of a blueprint.

/** Publishes n questions of a difficulty in a topic. */
async function publish(
  creator: Account,
  reviewer: Account,
  topic: Topic,
  difficulty: Difficulty,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const q = await creator.api.createQuestion(
      textQuestion([topic.id], unique(`${topic.nameEn} ${difficulty}`), { difficulty }),
    );
    await creator.api.act(q.id, 'submit-review');
    await reviewer.api.act(q.id, 'approve');
  }
}

/** The options of a select, as the text a person reads. */
async function optionsOf(page: Page, label: string, scope = page.locator('form')) {
  return scope.getByLabel(label, { exact: true }).locator('option').allTextContents();
}

async function failure(call: Promise<unknown>) {
  const err = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test.describe('The shared bank, topics and blueprints in several packs', () => {
  test('E2E-CAT-05 · Subtopics', { tag: '@smoke' }, async ({ page, accounts, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const geometry = await newTopic();

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/topics'));
    const form = page.getByRole('form', { name: 'Add a topic' });
    const parent = form.getByLabel('Parent topic', { exact: true });
    await expect(form.getByLabel('Competition')).toHaveCount(0); // a topic has no competition
    const add = async (parentName: string, name: string) => {
      await parent.selectOption({ label: parentName });
      await form.getByLabel('Name (English)', { exact: true }).fill(name);
      await form.getByRole('button', { name: 'Add topic' }).click();
      await expectNotice(page, 'Topic added.');
    };
    const nameCell = (name: string) => row(page, name).getByRole('cell').first();

    const plane = unique('Plane');
    await add(geometry.nameEn, plane);
    await expect(nameCell(plane)).toHaveCSS('padding-left', '40px');

    const triangles = unique('Triangles');
    await add(`– ${plane}`, triangles);
    await expect(nameCell(triangles)).toHaveCSS('padding-left', '64px');

    // The third level cannot have children: it is not offered as a parent.
    expect(await optionsOf(page, 'Parent topic', form)).not.toContain(`– – ${triangles}`);
    expect(await optionsOf(page, 'Parent topic', form)).toContain(`– ${plane}`);

    // The rules, through the API.
    const all = await creator.api.topics();
    const deepest = all.find((t) => t.nameEn === triangles)!;
    const tooDeep = await failure(
      creator.api.createTopic({ parentId: deepest.id, nameEn: 'x', nameVi: null }),
    );
    expect([tooDeep.status, tooDeep.details.field]).toEqual([422, 'parentId']);

    // Depth first, with parentId and depth.
    const at = (id: string) => all.findIndex((t) => t.id === id);
    const planeTopic = all.find((t) => t.nameEn === plane)!;
    expect(at(planeTopic.id)).toBe(at(geometry.id) + 1);
    expect(at(deepest.id)).toBe(at(planeTopic.id) + 1);
    expect([planeTopic.parentId, planeTopic.depth, deepest.depth]).toEqual([geometry.id, 2, 3]);
  });

  test(
    'E2E-CAT-06 · Rename, move and delete topics',
    { tag: '@smoke' },
    async ({ page, accounts, asmoPack, newTopic }) => {
      const creator = await accounts.staff('CONTENT_CREATOR');
      const geometry = await newTopic();
      const time = await newTopic();
      const logic = await newTopic();
      const plane = await creator.api.createTopic({
        parentId: geometry.id,
        nameEn: unique('Plane'),
        nameVi: null,
      });
      const triangles = await creator.api.createTopic({
        parentId: plane.id,
        nameEn: unique('Triangles'),
        nameVi: null,
      });

      await signInStaff(page, creator.email, creator.password);
      await page.goto(adminSite('/topics'));
      const edit = (name: string) => page.getByRole('button', { name: `Edit ${name}` });

      // Rename.
      const renamed = unique('Reasoning');
      await edit(logic.nameEn).click();
      const editing = page.getByRole('row').filter({ has: page.getByLabel('Name (English)') });
      await editing.getByLabel('Name (English)').fill(renamed);
      await editing.getByRole('button', { name: 'Save' }).click();
      await expectNotice(page, 'Topic updated.');
      await expect(row(page, renamed)).toBeVisible();

      // Move a topic with its subtopic: the list leaves out what would be too deep or a cycle.
      await edit(plane.nameEn).click();
      const parents = await editing.getByLabel('Parent topic').locator('option').allTextContents();
      expect(parents).toContain(time.nameEn);
      expect(parents).not.toContain(`– ${plane.nameEn}`);
      expect(parents).not.toContain(`– – ${triangles.nameEn}`);
      await editing.getByLabel('Parent topic').selectOption({ label: time.nameEn });
      await editing.getByRole('button', { name: 'Save' }).click();
      await expectNotice(page, 'Topic updated.');
      const moved = (await creator.api.topics()).find((t) => t.id === triangles.id)!;
      expect(moved.depth).toBe(3);
      expect((await creator.api.topics()).find((t) => t.id === plane.id)!.parentId).toBe(time.id);

      // A move that would leave a blueprint with a topic and its subtopic names the blueprint.
      const name = unique('Clash mock');
      await creator.api.createBlueprint({
        examPackIds: [asmoPack.id],
        name,
        totalQuestions: 3,
        timeLimitMinutes: 20,
        topicDistribution: [
          { topicId: time.id, count: 1 },
          { topicId: geometry.id, count: 2 },
        ],
      });
      await edit(geometry.nameEn).click();
      await editing.getByLabel('Parent topic').selectOption({ label: time.nameEn });
      await editing.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('alert')).toContainText(name);
      await editing.getByRole('button', { name: 'Cancel' }).click();

      // Delete: a topic that nothing uses goes; one that is used says what uses it.
      page.once('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: `Delete ${renamed}` }).click();
      await expectNotice(page, 'Topic deleted.');
      await expect(row(page, renamed)).toHaveCount(0);

      page.once('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: `Delete ${geometry.nameEn}` }).click();
      await expect(page.getByRole('alert')).toContainText('The topic is still in use');
      await expect(page.getByRole('alert')).toContainText(name);
    },
  );

  test('E2E-BLP-09 · Blueprints and subtopics', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const time = await newTopic();
    const geometry = await newTopic();
    const sub = (parent: Topic, name: string) =>
      creator.api.createTopic({ parentId: parent.id, nameEn: unique(name), nameVi: null });
    const plane = await sub(geometry, 'Plane');
    const solid = await sub(geometry, 'Solid');
    const triangles = await sub(plane, 'Triangles');

    await publish(creator, reviewer, plane, 'EASY', 3);
    await publish(creator, reviewer, solid, 'EASY', 2);
    await publish(creator, reviewer, time, 'EASY', 2);

    // The content-gap table is a tree, and a parent counts the questions of its subtopics.
    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/content-gaps'));
    const counted = (topic: Topic, n: number) =>
      page.getByLabel(new RegExp(`^${topic.nameEn}, Easy: ${n} published`));
    await expect(counted(geometry, 5)).toBeVisible();
    await expect(counted(plane, 3)).toBeVisible();
    await expect(counted(solid, 2)).toBeVisible();
    await expect(page.getByRole('rowheader', { name: plane.nameEn })).toHaveCSS(
      'padding-left',
      '40px',
    );

    // A blueprint with Geometry 4 is ready: the questions of its subtopics fill it.
    const pack = asmoPack;
    const name = unique('Subtopics mock');
    await page.goto(adminSite('/mock-exams/new'));
    const form = page.getByRole('form', { name: 'New blueprint' });
    await form.getByRole('checkbox', { name: pack.name, exact: true }).check();
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Total questions', { exact: true }).fill('6');
    await form.getByLabel('Time limit (minutes)', { exact: true }).fill('20');
    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 1', { exact: true }).selectOption({ label: time.nameEn });
    await form.getByLabel('Questions 1', { exact: true }).fill('2');
    await form.getByRole('button', { name: 'Add topic' }).click();
    await form.getByLabel('Topic 2', { exact: true }).selectOption({ label: geometry.nameEn });
    await form.getByLabel('Questions 2', { exact: true }).fill('4');
    await form.getByRole('button', { name: 'Save' }).click();
    await expectNotice(page, 'Blueprint saved.');

    await page.goto(adminSite('/mock-exams'));
    await expect(row(page, name)).toContainText('Ready');

    await page.getByRole('link', { name, exact: true }).click();
    const panel = page.getByRole('region', { name: 'Sample exam' });
    await panel.getByRole('button', { name: 'Generate sample exam' }).click();
    await expect(panel.locator('ol > li')).toHaveCount(6);
    await expect(panel.getByText(new RegExp(`^${geometry.nameEn} · `))).toHaveCount(4);
    await expect(panel.getByText(new RegExp(`^${time.nameEn} · `))).toHaveCount(2);

    // Plane geometry alone has 3 questions, not 4.
    const short = await creator.api.createBlueprint({
      examPackIds: [pack.id],
      name: unique('Plane mock'),
      totalQuestions: 4,
      timeLimitMinutes: 20,
      topicDistribution: [{ topicId: plane.id, count: 4 }],
    });
    await page.goto(adminSite(`/mock-exams/${short.id}`));
    await expect(
      page.getByRole('region', { name: 'Question bank' }).getByRole('alert'),
    ).toContainText(`Topic ${plane.nameEn}: needs 4, has 3`);

    // The form shows the topics related to the one of another row, disabled, with the reason.
    await page.goto(adminSite('/mock-exams/new'));
    const fresh = page.getByRole('form', { name: 'New blueprint' });
    await fresh.getByRole('button', { name: 'Add topic' }).click();
    await fresh.getByLabel('Topic 1', { exact: true }).selectOption({ label: `– ${plane.nameEn}` });
    await fresh.getByRole('button', { name: 'Add topic' }).click();
    const second = fresh.getByLabel('Topic 2', { exact: true });
    for (const [topic, label] of [
      [geometry, geometry.nameEn],
      [plane, `– ${plane.nameEn}`],
      [triangles, `– – ${triangles.nameEn}`],
    ] as const) {
      const option = second.locator('option', { hasText: topic.nameEn });
      await expect(option).toBeDisabled();
      expect(await option.textContent()).toContain(label);
    }
    await expect(second.locator('option', { hasText: solid.nameEn })).toBeEnabled();
    await expect(second.locator('option', { hasText: time.nameEn })).toBeEnabled();
    await expect(second.locator('option', { hasText: plane.nameEn })).toContainText(
      'already in row 1',
    );
    await expect(second.locator('option', { hasText: geometry.nameEn })).toContainText(
      'related to the topic of row 1',
    );

    // The API refuses a topic and its subtopic together.
    const overlap = await failure(
      creator.api.createBlueprint({
        examPackIds: [pack.id],
        name: unique('Overlap'),
        totalQuestions: 4,
        timeLimitMinutes: 20,
        topicDistribution: [
          { topicId: geometry.id, count: 2 },
          { topicId: plane.id, count: 2 },
        ],
      }),
    );
    expect([overlap.status, overlap.details.field]).toEqual([422, 'topicDistribution[1].topicId']);

    // A search by topic includes the subtopics.
    const found = await creator.api.searchQuestions(
      `topicId=${geometry.id}&status=PUBLISHED&pageSize=50`,
    );
    expect(found.total).toBe(5);
  });

  test(
    'E2E-BLP-10 · One blueprint in several exam packs',
    { tag: '@smoke' },
    async ({ page, accounts, asmoPack, timoPack, newTopic }) => {
      const creator = await accounts.staff('CONTENT_CREATOR');
      const topic = await newTopic();
      const name = unique('Two packs');
      const blueprint = await creator.api.createBlueprint({
        examPackIds: [asmoPack.id],
        name,
        totalQuestions: 2,
        timeLimitMinutes: 10,
        topicDistribution: [{ topicId: topic.id, count: 2 }],
      });

      await signInStaff(page, creator.email, creator.password);
      await page.goto(adminSite('/mock-exams'));
      const filter = page.getByLabel('Exam pack', { exact: true });
      await filter.selectOption({ label: timoPack.name });
      await expect(row(page, name)).toHaveCount(0);

      // Offer it in TIMO too: it is listed under both packs, with both names.
      await page.goto(adminSite(`/mock-exams/${blueprint.id}`));
      const form = page.getByRole('form', { name: 'Edit blueprint' });
      await expect(form.getByRole('checkbox', { name: asmoPack.name, exact: true })).toBeChecked();
      await expect(
        form.getByRole('checkbox', { name: timoPack.name, exact: true }),
      ).not.toBeChecked();
      await form.getByRole('checkbox', { name: timoPack.name, exact: true }).check();
      await form.getByRole('button', { name: 'Save' }).click();
      await expectNotice(page, 'Blueprint saved.');

      await page.goto(adminSite('/mock-exams'));
      await expect(row(page, name)).toContainText(asmoPack.name);
      await expect(row(page, name)).toContainText(timoPack.name);
      await page.getByLabel('Exam pack', { exact: true }).selectOption({ label: timoPack.name });
      await expect(row(page, name)).toBeVisible();
      await page.getByLabel('Exam pack', { exact: true }).selectOption({ label: asmoPack.name });
      await expect(row(page, name)).toBeVisible();

      // Without ASMO it is listed under TIMO only; a blueprint needs a pack.
      await page.goto(adminSite(`/mock-exams/${blueprint.id}`));
      await form.getByRole('checkbox', { name: asmoPack.name, exact: true }).uncheck();
      await form.getByRole('checkbox', { name: timoPack.name, exact: true }).uncheck();
      await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
      await expect(form.getByText('Tick at least one exam pack')).toBeVisible();
      await form.getByRole('checkbox', { name: timoPack.name, exact: true }).check();
      await form.getByRole('button', { name: 'Save' }).click();
      await expectNotice(page, 'Blueprint saved.');
    },
  );
});
