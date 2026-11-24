import { Api, publicApi, type ExamPack, type PackStatus } from './api';
import { PASSWORD, unique, uniqueEmail, uniquePhone } from './data';
import { withLock } from './lock';
import { textQuestion } from './pages/questions';

/**
 * What the tests of orders need that is shared: the payment details, a pack a student can buy (it has an
 * exam), and packs without one. Grade 1 packs belong to the other tests, so these use the highest grades that cannot be mistaken for Grade 1.
 */

const SHOP_BLUEPRINT = 'E2E shop exam';
const BANK = {
  bankName: 'Test Bank',
  accountNumber: '0123456789',
  accountName: 'VIETMATH TEST',
  qrImageUrl: null,
};

/** Saves payment details when none are saved yet (students cannot order without them). */
export async function ensurePaymentDetails(admin: Api): Promise<void> {
  await withLock('payment-details', async () => {
    try {
      await admin.paymentDetails();
    } catch {
      await admin.savePaymentDetails(BANK);
    }
  });
}

/**
 * A pack of a grade and competition nobody used yet, from Grade 9 down (the catalog tests count up). Not
 * Grades 10 to 12: "ASMO Grade 12" contains "ASMO Grade 1", the name the other tests look for.
 */
async function freePair(admin: Api): Promise<{ gradeId: number; competitionId: string }> {
  const taken = new Set((await admin.examPacks()).map((p) => `${p.grade.id}:${p.competition.id}`));
  for (let gradeId = 9; gradeId >= 2; gradeId--) {
    for (const c of await publicApi.competitions(gradeId)) {
      if (!taken.has(`${gradeId}:${c.id}`)) return { gradeId, competitionId: c.id };
    }
  }
  throw new Error('every exam pack of the catalog exists already');
}

/** A new exam pack with no exam (and no blueprint), 499,000 VND for 12 months. */
export function newPack(admin: Api, status: PackStatus = 'DRAFT'): Promise<ExamPack> {
  return withLock('pack-pair', async () => {
    const draft = await admin.createExamPack({
      ...(await freePair(admin)),
      price: 499000,
      validityMonths: 12,
    });
    return status === 'DRAFT' ? draft : admin.updateExamPack(draft.id, { status, confirm: true });
  });
}

/** A user of a staff role of its own, signed in. */
async function staff(admin: Api, role: 'CONTENT_CREATOR' | 'REVIEWER'): Promise<Api> {
  const email = uniqueEmail(role.toLowerCase());
  await admin.createStaff({
    email,
    fullName: `Shop ${role}`,
    phoneNumber: uniquePhone(),
    staffRole: role,
    password: PASSWORD,
  });
  return Api.login(email, PASSWORD);
}

/**
 * A pack on sale that a student can buy: it has an ACTIVE blueprint that published questions fill. Made once
 * for all workers.
 */
export function shopPack(admin: Api): Promise<ExamPack> {
  return withLock('shop-pack', async () => {
    const found = (await admin.blueprints()).find((b) => b.name === SHOP_BLUEPRINT);
    if (found) {
      const pack = (await admin.examPacks()).find((p) => p.id === found.examPackIds[0]);
      if (pack) return pack;
    }

    return (await buildShopPack(admin, SHOP_BLUEPRINT)).pack;
  });
}

/** A pack with an exam of its own (a blueprint that published questions fill), to take the exam away in a test. */
export async function ownShopPack(admin: Api): Promise<{ pack: ExamPack; blueprintId: string }> {
  return withLock('shop-pack-own', () => buildShopPack(admin, unique('Own shop exam')));
}

async function buildShopPack(
  admin: Api,
  blueprintName: string,
): Promise<{ pack: ExamPack; blueprintId: string }> {
  {
    const pack = await newPack(admin, 'ACTIVE');
    const [creator, reviewer] = await Promise.all([
      staff(admin, 'CONTENT_CREATOR'),
      staff(admin, 'REVIEWER'),
    ]);
    const topic = await admin.createTopic({ nameEn: unique('Shop topic'), nameVi: null });
    for (let i = 0; i < 6; i++) {
      const q = await creator.createQuestion(textQuestion([topic.id], unique('Shop question')));
      await creator.act(q.id, 'submit-review');
      await reviewer.act(q.id, 'approve');
    }
    const blueprint = await creator.createBlueprint({
      examPackIds: [pack.id],
      name: blueprintName,
      totalQuestions: 4,
      timeLimitMinutes: 30,
      status: 'ACTIVE',
      topicDistribution: [{ topicId: topic.id, count: 4 }],
    });
    return { pack, blueprintId: blueprint.id };
  }
}
