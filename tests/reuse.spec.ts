import type { Page } from '@playwright/test';
import { ApiError, publicApi, type Difficulty, type ExamPack, type Topic } from '../support/api';
import { unique } from '../support/data';
import type { Account } from '../support/fixtures';
import { expect, test } from '../support/fixtures';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import { QuestionEditor, textQuestion } from '../support/pages/questions';

// Release Phase 4.5: a question in several exam packs, and the topic tree (E2E-CAT-05,
// E2E-QB-11 and E2E-BLP-09). The API checks every rule (the blackbox suite); these tests check
// what only the browser shows: the tick list of packs and the topics that follow it, the
// parent field and the indented lists.

/** Publishes n questions of a difficulty in a topic, in the given exam packs. */
async function publish(
  creator: Account,
  reviewer: Account,
  packs: ExamPack[],
  topic: Topic,
  difficulty: Difficulty,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const q = await creator.api.createQuestion(
      textQuestion(packs[0]!.id, [topic.id], unique(`${topic.nameEn} ${difficulty}`), {
        difficulty,
        examPackIds: packs.map((p) => p.id),
      }),
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

test.describe('Reusable questions and subtopics', () => {
  test('E2E-CAT-05 · Subtopics', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const geometry = await newTopic(); // an ASMO topic
    const time = await newTopic(null); // a shared topic
    const timo = (await publicApi.competitions(1)).find((c) => c.code === 'TIMO')!;

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/topics'));
    const form = page.getByRole('form', { name: 'Add a topic' });
    const parent = form.getByLabel('Parent topic', { exact: true });
    const competition = form.getByLabel('Competition', { exact: true });
    const add = async (parentName: string, name: string) => {
      await parent.selectOption({ label: parentName });
      await form.getByLabel('Name (English)', { exact: true }).fill(name);
      await form.getByRole('button', { name: 'Add topic' }).click();
      await expectNotice(page, 'Topic added.');
    };
    const nameCell = (name: string) =>
      page.getByRole('row').filter({ hasText: name }).getByRole('cell').first();

    // A subtopic of an ASMO topic belongs to ASMO: the competition is fixed.
    const plane = unique('Plane');
    await parent.selectOption({ label: geometry.nameEn });
    await expect(competition).toBeDisabled();
    await expect(competition).toHaveValue(asmoPack.competition.id);
    await add(geometry.nameEn, plane);
    await expect(nameCell(plane)).toHaveCSS('padding-left', '40px');

    const triangles = unique('Triangles');
    await add(`– ${plane}`, triangles);
    await expect(nameCell(triangles)).toHaveCSS('padding-left', '64px');

    // The third level cannot have children: it is not offered as a parent.
    expect(await optionsOf(page, 'Parent topic', form)).not.toContain(`– – ${triangles}`);
    expect(await optionsOf(page, 'Parent topic', form)).toContain(`– ${plane}`);

    // A subtopic of a shared topic can belong to one competition.
    const clocks = unique('Clocks');
    await parent.selectOption({ label: time.nameEn });
    await expect(competition).toBeEnabled();
    await competition.selectOption({ label: asmoPack.competition.name });
    await form.getByLabel('Name (English)', { exact: true }).fill(clocks);
    await form.getByRole('button', { name: 'Add topic' }).click();
    await expectNotice(page, 'Topic added.');

    // It is an ASMO topic, not a shared one; and a TIMO pack does not offer it.
    const filter = page.getByLabel('Filter by competition');
    await filter.selectOption({ label: asmoPack.competition.name });
    await expect(page.getByRole('row').filter({ hasText: clocks })).toBeVisible();
    await filter.selectOption({ label: 'Shared (all competitions)' });
    await expect(page.getByRole('row').filter({ hasText: time.nameEn })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: clocks })).toHaveCount(0);
    const forTimo = (await creator.api.topics(timo.id)).map((t) => t.nameEn);
    expect(forTimo).toContain(time.nameEn);
    expect(forTimo).not.toContain(clocks);

    // The rules, through the API.
    const all = await creator.api.topics();
    const deepest = all.find((t) => t.nameEn === triangles)!;
    const tooDeep = await failure(
      creator.api.createTopic({ parentId: deepest.id, nameEn: 'x', nameVi: null }),
    );
    expect([tooDeep.status, tooDeep.details.field]).toEqual([422, 'parentId']);

    const foreign = await failure(
      creator.api.createTopic({
        parentId: geometry.id,
        competitionId: timo.id,
        nameEn: 'x',
        nameVi: null,
      }),
    );
    expect([foreign.status, foreign.details.field]).toEqual([422, 'competitionId']);

    // Depth first, with parentId and depth.
    const asmoTopics = await creator.api.topics(asmoPack.competition.id);
    const at = (id: string) => asmoTopics.findIndex((t) => t.id === id);
    const planeTopic = all.find((t) => t.nameEn === plane)!;
    expect(at(planeTopic.id)).toBe(at(geometry.id) + 1);
    expect(at(deepest.id)).toBe(at(planeTopic.id) + 1);
    expect([planeTopic.parentId, planeTopic.depth, deepest.depth]).toEqual([geometry.id, 2, 3]);
  });

  test('E2E-QB-11 · One question for several exam packs', async ({
    page,
    accounts,
    asmoPack,
    timoPack,
    newTopic,
  }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const shared = await newTopic(null);
    const asmoOnly = await newTopic();

    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite('/questions/new'));
    const topic = (t: Topic) => page.getByRole('checkbox', { name: t.nameEn, exact: true });

    // One ASMO pack: the ASMO topic and the shared topic are offered.
    await page.getByRole('checkbox', { name: asmoPack.name }).check();
    await expect(topic(asmoOnly)).toBeVisible();
    await topic(asmoOnly).check();

    // The TIMO pack too: the ASMO topic cannot tag the question, so it goes (and is unticked).
    await page.getByRole('checkbox', { name: timoPack.name }).check();
    await expect(topic(asmoOnly)).toHaveCount(0);
    await topic(shared).check();

    const prompt = unique("Which clock shows three o'clock");
    const editor = new QuestionEditor(page);
    await editor.classify({ pack: [], topics: [], language: 'English' });
    await page.getByLabel('Question (English)').fill(prompt);
    await editor.choiceCount(2);
    await page.getByLabel('Answer A (English)').fill('Three');
    await page.getByLabel('Answer B (English)').fill('Four');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expectNotice(page, 'Question saved as a draft.');

    const saved = await creator.api.searchQuestions(
      `examPackId=${timoPack.id}&q=${encodeURIComponent(prompt)}`,
    );
    expect(saved.items).toHaveLength(1);
    expect([...saved.items[0]!.examPackIds].sort()).toEqual([asmoPack.id, timoPack.id].sort());
    expect(saved.items[0]!.topicIds).toEqual([shared.id]);

    // Approved once, published for both.
    const id = saved.items[0]!.id;
    await creator.api.act(id, 'submit-review');
    await reviewer.api.act(id, 'approve');
    for (const pack of [asmoPack, timoPack]) {
      const found = await reviewer.api.searchQuestions(
        `examPackId=${pack.id}&status=PUBLISHED&q=${encodeURIComponent(prompt)}`,
      );
      expect(found.items.map((q) => q.id)).toEqual([id]);
    }

    // Found, with both packs shown, through each pack's filter.
    for (const pack of [asmoPack, timoPack]) {
      await page.goto(adminSite(`/questions?examPackId=${pack.id}&status=PUBLISHED`));
      await page.getByRole('searchbox', { name: 'Search' }).fill(prompt);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: prompt });
      await expect(row).toContainText(asmoPack.name);
      await expect(row).toContainText(timoPack.name);
    }

    // The rules, through the API.
    const attempt = (extra: object) =>
      creator.api.createQuestion({
        ...textQuestion(asmoPack.id, [shared.id], unique('x')),
        ...extra,
      });
    expect(
      (await failure(attempt({ examPackIds: [asmoPack.id, timoPack.id], topicIds: [asmoOnly.id] })))
        .details.field,
    ).toBe('topicIds');
    expect((await failure(attempt({ examPackIds: [] }))).details.field).toBe('examPackIds');
    expect(
      (await failure(attempt({ examPackIds: [asmoPack.id, asmoPack.id] }))).details.field,
    ).toBe('examPackIds');

    // A published question is read-only, packs included.
    await page.goto(adminSite(`/questions/${id}`));
    await expect(page.getByRole('checkbox', { name: asmoPack.name })).toHaveCount(0);
  });

  test('E2E-BLP-09 · Blueprints and subtopics', async ({ page, accounts, asmoPack, newTopic }) => {
    const creator = await accounts.staff('CONTENT_CREATOR');
    const reviewer = await accounts.staff('REVIEWER');
    const time = await newTopic(null);
    const geometry = await newTopic();
    const sub = (parent: Topic, name: string) =>
      creator.api.createTopic({ parentId: parent.id, nameEn: unique(name), nameVi: null });
    const plane = await sub(geometry, 'Plane');
    const solid = await sub(geometry, 'Solid');
    const triangles = await sub(plane, 'Triangles');
    void triangles;

    await publish(creator, reviewer, [asmoPack], plane, 'EASY', 3);
    await publish(creator, reviewer, [asmoPack], solid, 'EASY', 2);
    await publish(creator, reviewer, [asmoPack], time, 'EASY', 2);

    // The content-gap table is a tree, and a parent counts the questions of its subtopics.
    await signInStaff(page, creator.email, creator.password);
    await page.goto(adminSite(`/content-gaps?examPackId=${asmoPack.id}`));
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
    const name = unique('Subtopics mock');
    await page.goto(adminSite('/mock-exams/new'));
    const form = page.getByRole('form', { name: 'New blueprint' });
    await form.getByLabel('Exam pack', { exact: true }).selectOption({ label: asmoPack.name });
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
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Ready');

    await page.getByRole('link', { name, exact: true }).click();
    const panel = page.getByRole('region', { name: 'Sample exam' });
    await panel.getByRole('button', { name: 'Generate sample exam' }).click();
    await expect(panel.locator('ol > li')).toHaveCount(6);
    await expect(panel.getByText(new RegExp(`^${geometry.nameEn} · `))).toHaveCount(4);
    await expect(panel.getByText(new RegExp(`^${time.nameEn} · `))).toHaveCount(2);

    // Plane geometry alone has 3 questions, not 4.
    const short = await creator.api.createBlueprint({
      examPackId: asmoPack.id,
      name: unique('Plane mock'),
      totalQuestions: 4,
      timeLimitMinutes: 20,
      topicDistribution: [{ topicId: plane.id, count: 4 }],
    });
    await page.goto(adminSite(`/mock-exams/${short.id}`));
    await expect(
      page.getByRole('region', { name: 'Question bank' }).getByRole('alert'),
    ).toContainText(`Topic ${plane.nameEn}: needs 4, has 3`);

    // The form does not offer a topic next to its subtopic.
    await page.goto(adminSite('/mock-exams/new'));
    const fresh = page.getByRole('form', { name: 'New blueprint' });
    await fresh.getByLabel('Exam pack', { exact: true }).selectOption({ label: asmoPack.name });
    await fresh.getByRole('button', { name: 'Add topic' }).click();
    await fresh.getByLabel('Topic 1', { exact: true }).selectOption({ label: `– ${plane.nameEn}` });
    await fresh.getByRole('button', { name: 'Add topic' }).click();
    const offered = await optionsOf(page, 'Topic 2', fresh);
    expect(offered).toContain(`– ${solid.nameEn}`);
    expect(offered).toContain(time.nameEn);
    for (const gone of [geometry.nameEn, `– ${plane.nameEn}`, `– – ${triangles.nameEn}`]) {
      expect(offered).not.toContain(gone);
    }

    // The API refuses a topic and its subtopic together.
    const overlap = await failure(
      creator.api.createBlueprint({
        examPackId: asmoPack.id,
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
});
