import { expect, type Page } from '@playwright/test';
import type { Account } from '../support/fixtures';
import { test } from '../support/fixtures';
import { apiURL } from '../support/env';
import { newPack, ownShopPack } from '../support/shop';
import { signIn } from '../support/pages/auth';

// Release Phase 5, the student web: buy an exam pack, pay by transfer and send proof (E2E-ORD-01 to 06, 10
// and 13), take a mock exam, see the result and the history (E2E-ATT-01, 03 and 08), practice by topic (E2E-ATT-09). The admin decides through
// the API here; the admin screens are tested in orders.spec.ts. The API checks every rule (the blackbox suite).

const SCREENSHOT = 'assets/clock.png';

async function signedIn(page: Page, accounts: { customer: () => Promise<Account> }) {
  const student = await accounts.customer();
  await signIn(page, student.email, student.password);
  return student;
}

/** Opens the pack and buys it; the order page opens. Returns the order code. */
async function buy(page: Page, packId: string): Promise<string> {
  await page.goto(`/packs/${packId}`);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const heading = page.getByRole('heading', { level: 1, name: /^Order / });
  await expect(heading).toBeVisible();
  return ((await heading.textContent()) ?? '').replace('Order ', '').trim();
}

test.describe('Orders (student web)', () => {
  test('E2E-ORD-01 · A student buys a pack and sees how to pay; with the order open there is no Buy', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    const student = await signedIn(page, accounts);
    const code = await buy(page, buyablePack.id);

    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    await expect(page.getByText('Awaiting payment')).toBeVisible();
    await expect(page.getByText('499,000 VND')).toBeVisible();
    await expect(page.getByText('Test Bank')).toBeVisible();
    await expect(page.getByText('0123456789')).toBeVisible();
    await expect(
      page.getByText(`Write ${code} in the description of your transfer.`),
    ).toBeVisible();

    // ORD-02: one open order per pack. The pack page says so and has no Buy; the API gives the same order.
    await page.goto(`/packs/${buyablePack.id}`);
    await expect(
      page.getByText(
        `You have already ordered this exam pack (order ${code}) and have not paid yet.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
    expect((await student.api.buy(buyablePack.id)).code).toBe(code);
    await page.getByRole('link', { name: 'Go to your order' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Order ${code}` })).toBeVisible();
    await page.goto('/orders');
    await expect(page.getByRole('link', { name: /^Open order / })).toHaveCount(1);
  });

  test('E2E-ORD-03 · Send proof, wait for the admin, then the pack is mine', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await signedIn(page, accounts);
    const code = await buy(page, buyablePack.id);

    const form = page.getByRole('form', { name: 'Send proof' });
    await form.getByLabel('Screenshot of the transfer').setInputFiles(SCREENSHOT);
    await form.getByLabel('Sender name').fill('NGUYEN VAN A');
    await form.getByRole('button', { name: 'Submit' }).click();

    await expect(page.getByText('We have your proof and are checking the payment.')).toBeVisible();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    await expect(page.getByText('NGUYEN VAN A')).toBeVisible();
    await page.getByRole('button', { name: 'Show the screenshot' }).click();
    const image = page.getByRole('img', { name: 'Screenshot of the transfer' });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    // Once paid, only the admin cancels.
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

    const order = (await student.api.orders()).find((o) => o.code === code);
    await admin.confirmOrder(order!.id);
    await page.reload();
    await expect(page.getByText(/Payment confirmed/)).toBeVisible();

    await page.goto('/my-packs');
    await expect(page.getByRole('link', { name: buyablePack.name })).toBeVisible();
    await expect(page.getByText(/Access until/)).toBeVisible();
    await page.goto('/orders');
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  });

  test('E2E-ORD-04 · Proof rules, and a screenshot is private', async ({
    page,
    accounts,
    buyablePack,
    newBrowser,
  }) => {
    const student = await signedIn(page, accounts);
    const other = await accounts.customer();
    const code = await buy(page, buyablePack.id);

    // A note alone is not a proof.
    const form = page.getByRole('form', { name: 'Send proof' });
    await expect(form.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await form.getByLabel('Note').fill('paid');
    await expect(form.getByRole('button', { name: 'Submit' })).toBeDisabled();

    // Not an image: refused.
    await form.getByLabel('Screenshot of the transfer').setInputFiles('assets/not-an-image.png');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(form.getByRole('alert')).toContainText('JPEG, PNG, GIF and WebP');

    // A blank sender name counts as empty.
    await form.getByLabel('Screenshot of the transfer').setInputFiles(SCREENSHOT);
    await form.getByLabel('Sender name').fill('   ');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('We have your proof and are checking the payment.')).toBeVisible();
    // The proof shows no sender name.
    const proof1 = page.getByRole('listitem').filter({ hasText: 'Proof 1' });
    await expect(proof1.locator('div', { hasText: /^Sender name—$/ })).toBeVisible();

    // The screenshot opens for its owner only.
    const order = (await student.api.orders()).find((o) => o.code === code)!;
    const proof = (await student.api.order(order.id)).proofs[0]!;
    const url = `${apiURL}/orders/${order.id}/proofs/${proof.id}/image`;
    expect((await fetch(url)).status).toBe(401);
    expect(
      (await fetch(url, { headers: { Authorization: `Bearer ${other.api.token}` } })).status,
    ).toBe(404);
    expect(
      (await fetch(url, { headers: { Authorization: `Bearer ${student.api.token}` } })).status,
    ).toBe(200);

    // Another student does not see the order at all.
    const second = await newBrowser();
    await signIn(second, other.email, other.password);
    await second.goto(`/orders/${order.id}`);
    await expect(second.getByRole('alert')).toBeVisible();
    await expect(second.getByText(`Order ${code}`)).toHaveCount(0);
  });

  test('E2E-ORD-05 · Rejected: the reason, then new proof and the confirmation', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await signedIn(page, accounts);
    const code = await buy(page, buyablePack.id);
    await page
      .getByRole('form', { name: 'Send proof' })
      .getByLabel('Sender name')
      .fill('NGUYEN VAN B');
    await page
      .getByRole('form', { name: 'Send proof' })
      .getByRole('button', { name: 'Submit' })
      .click();
    await expect(page.getByText('Waiting for verification')).toBeVisible();

    const order = (await student.api.orders()).find((o) => o.code === code)!;
    await admin.rejectOrder(order.id, 'Received 300,000 of 499,000. 199,000 is missing.');
    await page.reload();
    await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
    await expect(page.getByText(/199,000 is missing/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

    // The student pays the rest and sends new proof; both proofs are listed, the new one last.
    const form = page.getByRole('form', { name: 'Send new proof' });
    await form.getByLabel('Sender name').fill('NGUYEN VAN C');
    await form.getByLabel('Note').fill('Paid the remaining 199,000 in cash at the center');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('We have your proof and are checking the payment.')).toBeVisible();
    await expect(page.getByText('Proof 1')).toBeVisible();
    await expect(page.getByText('Proof 2')).toBeVisible();

    await admin.confirmOrder(order.id);
    await page.reload();
    await expect(page.getByText(/Payment confirmed/)).toBeVisible();
    await expect(page.getByText('Proof 2')).toBeVisible();
  });

  test('E2E-ORD-06 · A student cancels an order that has no proof; a new one is a new order', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    const student = await signedIn(page, accounts);
    const first = await buy(page, buyablePack.id);

    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('This order was cancelled.')).toBeVisible();

    const second = await buy(page, buyablePack.id);
    expect(second).not.toBe(first);
    const form = page.getByRole('form', { name: 'Send proof' });
    await form.getByLabel('Bank reference').fill('FT2627900009');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

    // Once paid, the student cannot cancel it either (the API).
    const order = (await student.api.orders()).find((o) => o.code === second)!;
    await expect(student.api.cancelOrder(order.id, '')).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_ALREADY_PROCESSED',
    });
  });

  test('E2E-ORD-10 · My orders, the payment history, and nobody else’s', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await signedIn(page, accounts);
    await buy(page, buyablePack.id);
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('This order was cancelled.')).toBeVisible();

    const paid = await buy(page, buyablePack.id);
    await page
      .getByRole('form', { name: 'Send proof' })
      .getByLabel('Bank reference')
      .fill('FT2627900010');
    await page
      .getByRole('form', { name: 'Send proof' })
      .getByRole('button', { name: 'Submit' })
      .click();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    const order = (await student.api.orders()).find((o) => o.code === paid)!;
    await admin.confirmOrder(order.id, 600000);
    await admin.recordRefund(order.id, { amount: 100000, bankReference: 'FT2628011111' });

    await page.goto('/orders');
    await expect(page.getByRole('link', { name: /^Open order / })).toHaveCount(2);
    await page.getByLabel('Show').selectOption('paid');
    await expect(page.getByRole('link', { name: /^Open order / })).toHaveCount(1);
    await expect(page.getByText('Refunded: 100,000 VND')).toBeVisible();
    await page.getByRole('link', { name: `Open order ${paid}` }).click();
    await expect(page.getByText('Refunded: 100,000 VND')).toBeVisible();
    expect((await student.api.orders()).map((o) => o.status).sort()).toEqual([
      'CANCELLED',
      'CONFIRMED',
    ]);
  });

  test('E2E-ORD-13 · A pack that loses its exams: an open order says so and can still be paid', async ({
    page,
    accounts,
    admin,
  }) => {
    const { pack, blueprintId } = await ownShopPack(admin);
    const student = await signedIn(page, accounts);
    const code = await buy(page, pack.id);

    // The exam goes away: the pack is "Coming soon", and the open order says there is nothing to practise yet.
    await admin.setBlueprintStatus(blueprintId, 'DRAFT');
    await page.goto(`/packs/${pack.id}`);
    await expect(page.getByText(/Coming soon: this exam pack has no exams yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Go to your order' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Order ${code}` })).toBeVisible();
    await expect(page.getByText(/has no exams to practise for now/)).toBeVisible();

    // It can still be paid, and the access runs.
    const form = page.getByRole('form', { name: 'Send proof' });
    await form.getByLabel('Bank reference').fill('FT2627900011');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    const order = (await student.api.orders()).find((o) => o.code === code)!;
    await admin.confirmOrder(order.id);
    expect((await student.api.myEntitlements()).map((e) => e.examPackId)).toEqual([pack.id]);
  });

  test('E2E-ORD-13 · A pack without exams: Coming soon, no Buy', async ({
    page,
    accounts,
    admin,
  }) => {
    const pack = await newPack(admin, 'ACTIVE');
    await signedIn(page, accounts);
    await page.goto(`/packs/${pack.id}`);

    await expect(page.getByText(/Coming soon: this exam pack has no exams yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
  });
});

test.describe('Mock exams (student web)', () => {
  test('E2E-ATT-01 · Start an exam, answer, reload, submit, see the result and the history', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const order = await student.api.buy(buyablePack.id);
    await student.api.sendProof(order.id);
    await admin.confirmOrder(order.id);
    await signIn(page, student.email, student.password);

    await page.goto(`/packs/${buyablePack.id}`);
    await expect(page.getByText(/You have access until/)).toBeVisible();
    await page.getByRole('button', { name: /^Start / }).click();

    await expect(page).toHaveURL(/\/exams\/[0-9a-f-]+$/);
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible();
    const questions = page.getByRole('group', { name: /^Question \d/ });
    await expect(questions).toHaveCount(4);
    await expect(page.getByText("1 o'clock").first()).toBeVisible();

    // The first two get the right answer (A), the third a wrong one; the last is left alone.
    for (const [i, label] of [
      [0, 'A'],
      [1, 'A'],
      [2, 'B'],
    ] as const) {
      await questions
        .nth(i)
        .getByRole('radio', { name: new RegExp(`^${label}`) })
        .check();
    }
    await expect(page.getByText('3 of 4 answered')).toBeVisible();

    // The answers are saved: a reload keeps them, and the countdown goes on.
    await page.reload();
    await expect(page.getByText('3 of 4 answered')).toBeVisible();
    await expect(questions.nth(2).getByRole('radio', { name: /^B/ })).toBeChecked();
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible();

    // The explanations are for the result, not for the exam.
    await expect(page.getByText(/^Why:/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByRole('button', { name: 'Yes, submit' }).click();
    await expect(page).toHaveURL(/\/result$/);

    // Every question with the answer given and the right one; no answer is editable.
    await expect(page.getByText('Correct', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Wrong', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Not answered', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Correct answer')).toHaveCount(4);
    await expect(page.getByRole('radio')).toHaveCount(0);
    // Each question shows why its answer is right (the explanation was not there during the exam).
    await expect(page.getByRole('heading', { name: 'Explanation' })).toHaveCount(4);
    await expect(page.getByText(/^Why: Shop question/).first()).toBeVisible();
    // ... and the picture of the explanation, signed: it loads.
    const pictures = page.getByAltText('Explanation picture 1');
    await expect(pictures).toHaveCount(4);
    await expect
      .poll(() => pictures.first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    const attempt = (await student.api.attempts()).items[0]!;
    const result = await student.api.attemptResult(attempt.attemptId);
    expect(result.score).toBeGreaterThan(0);
    await expect(
      page.getByText(`${result.score} of ${result.totalPoints} points`, { exact: true }),
    ).toBeVisible();

    // The history lists it; the exam page of a submitted exam leads to the result.
    await page.goto('/history');
    await expect(page.getByRole('link', { name: /Standard|shop/i })).toHaveCount(1);
    await expect(page.getByText('Submitted')).toBeVisible();
    await page.goto(`/exams/${attempt.attemptId}`);
    await expect(page).toHaveURL(/\/result$/);

    // Another student has no history.
    const other = await accounts.customer();
    expect((await other.api.attempts()).items).toHaveLength(0);
  });

  test('E2E-ATT-03 · Without the pack: two free attempts of the whole exam, then buy', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    await signIn(page, student.email, student.password);

    // A free attempt is a whole exam, and the page says how many are left.
    await page.goto(`/packs/${buyablePack.id}`);
    await page.getByRole('button', { name: /^Try .* for free$/ }).click();
    await expect(
      page.getByText(/this is a free attempt. Free attempts left for this pack: 1/),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: /^Question \d/ })).toHaveCount(4);
    await expect(page.getByRole('link', { name: 'Buy', exact: true })).toHaveAttribute(
      'href',
      `/packs/${buyablePack.id}`,
    );

    await page.goto(`/packs/${buyablePack.id}`);
    await page.getByRole('button', { name: /^Try .* for free$/ }).click();
    await expect(page.getByText(/Free attempts left for this pack: 0/)).toBeVisible();

    // The third is refused, and the pack can still be bought.
    await page.goto(`/packs/${buyablePack.id}`);
    await page.getByRole('button', { name: /^Try .* for free$/ }).click();
    await expect(page.getByText(/the free attempts of this exam pack are used/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeVisible();

    // Buy the pack and have it confirmed: there is no limit, and no notice, from now on.
    const order = await student.api.buy(buyablePack.id);
    await student.api.sendProof(order.id);
    await admin.confirmOrder(order.id);
    await page.goto(`/packs/${buyablePack.id}`);
    await page.getByRole('button', { name: /^Start / }).click();
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible();
    await expect(page.getByText(/this is a free attempt/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: /^Question \d/ })).toHaveCount(4);
  });

  test('E2E-ATT-09 · Practice by topic: choose a topic and a size, 5 minutes a question, in the history', async ({
    page,
    newBrowser,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const order = await student.api.buy(buyablePack.id);
    await student.api.sendProof(order.id);
    await admin.confirmOrder(order.id);
    await signIn(page, student.email, student.password);

    await page.goto(`/packs/${buyablePack.id}`);
    await page.getByRole('link', { name: 'Practice by topic' }).click();
    await expect(page).toHaveURL(`/packs/${buyablePack.id}/practice`);

    // The topic of the pack's blueprint, with its 6 published questions: only 5 can be chosen.
    const topic = page.getByRole('radio', { name: /Shop topic/ });
    await expect(topic).toHaveCount(1);
    await expect(page.getByText('Questions: 6', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
    await topic.check();
    await expect(page.getByRole('radio', { name: /^5 questions · 25 minutes$/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^10 questions/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /^20 questions/ })).toBeDisabled();

    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(/\/exams\/[0-9a-f-]+$/);
    await expect(page.getByText(/^Practice: Shop topic/)).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible();
    const questions = page.getByRole('group', { name: /^Question \d/ });
    await expect(questions).toHaveCount(5);
    await expect(questions.first().getByText(/\(1 points\)$|\(1 point\)$/)).toBeVisible();

    await questions.first().getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByRole('button', { name: 'Yes, submit' }).click();
    await expect(page).toHaveURL(/\/result$/);
    await expect(page.getByText('Correct answer')).toHaveCount(5);

    const attempt = (await student.api.attempts()).items[0]!;
    expect(attempt.mode).toBe('PRACTICE');
    expect((await student.api.attemptResult(attempt.attemptId)).totalPoints).toBe(5);

    await page.goto('/history');
    await expect(page.getByRole('link', { name: /^Practice: Shop topic/ })).toHaveCount(1);

    // A student without the pack: no link, the page says so, the API refuses, and no free attempt is used.
    const other = await accounts.customer();
    const otherPage = await newBrowser();
    await signIn(otherPage, other.email, other.password);
    await otherPage.goto(`/packs/${buyablePack.id}`);
    await expect(otherPage.getByRole('button', { name: /for free$/ })).toBeVisible();
    await expect(otherPage.getByRole('link', { name: 'Practice by topic' })).toHaveCount(0);
    await otherPage.goto(`/packs/${buyablePack.id}/practice`);
    await expect(otherPage.getByText(/needs the exam pack/i)).toBeVisible();
    await expect(other.api.practiceTopics(buyablePack.id)).rejects.toMatchObject({
      status: 403,
      code: 'ENTITLEMENT_REQUIRED',
    });
    await expect(
      other.api.startPractice({ examPackId: buyablePack.id, topicId: 'x', questionCount: 5 }),
    ).rejects.toMatchObject({ status: 403, code: 'ENTITLEMENT_REQUIRED' });
  });
});
