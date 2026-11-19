import { expect, type Locator, type Page } from '@playwright/test';
import type { Account } from '../support/fixtures';
import { test } from '../support/fixtures';
import { Inbox } from '../support/mailpit';
import { newPack } from '../support/shop';
import { adminSite, expectNotice, signInStaff } from '../support/pages/auth';
import type { Order } from '../support/api';

// Release Phase 5, orders on the admin web: payment details, the verification queue, confirming and
// rejecting, cancelling with a refund, refunding an overpayment, and correcting an entitlement
// (E2E-ORD-01, 03, 05, 07, 08, 12 and 13). Students buy and send proof through the API here; the student web
// screens are tested with the student web.
// The API checks every rule (the blackbox suite, ORD-*); these tests check what the browser shows.

const SCREENSHOT = 'assets/clock.png';
const REFUND_SCREENSHOT = 'assets/two-dots.png';

/** A student who bought the pack and sent proof (a screenshot) of a transfer. */
async function waitingOrder(
  student: Account,
  packId: string,
  imagePath = SCREENSHOT,
): Promise<Order> {
  const order = await student.api.buy(packId);
  const { imageKey } = await student.api.uploadProofImage(order.id, imagePath);
  return student.api.sendProof(order.id, { imageKey, bankReference: 'FT2627900001' });
}

async function signInAdmin(
  page: Page,
  accounts: { staff: (r: 'SYSTEM_ADMIN') => Promise<Account> },
) {
  const admin = await accounts.staff('SYSTEM_ADMIN');
  await signInStaff(page, admin.email, admin.password);
  return admin;
}

const form = (page: Page, name: string): Locator => page.getByRole('form', { name, exact: true });

test.describe('Orders (admin web)', () => {
  test('E2E-ORD-01 · The admin sets the payment details; an order keeps the ones it was made with', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    await signInAdmin(page, accounts);
    await page
      .getByRole('navigation', { name: 'Staff', exact: true })
      .getByRole('link', { name: 'Payment details' })
      .click();

    const details = form(page, 'Payment details');
    await details.getByLabel('Bank', { exact: true }).fill('Test Bank');
    await details.getByLabel('Account number').fill('0123456789');
    await details.getByLabel('Account holder').fill('VIETMATH TEST');
    await details.getByLabel('Upload a QR code').setInputFiles(SCREENSHOT);
    await expect(details.getByRole('img', { name: 'Payment QR code' })).toBeVisible();
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expectNotice(page, 'Payment details saved.');

    const student = await accounts.customer();
    const first = await student.api.buy(buyablePack.id);
    expect(first.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(first.status).toBe('AWAITING_PAYMENT');
    expect(first.amount).toBe(499000);
    expect(first.paymentDetails.accountName).toBe('VIETMATH TEST');

    await details.getByLabel('Account holder').fill('VIETMATH TEST 2');
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Payment details saved.' }),
    ).toBeVisible();

    expect((await student.api.order(first.id)).paymentDetails.accountName).toBe('VIETMATH TEST');
    const second = await (await accounts.customer()).api.buy(buyablePack.id);
    expect(second.paymentDetails.accountName).toBe('VIETMATH TEST 2');
  });

  test('E2E-ORD-03 · The queue, a rejection, then the confirmation', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const order = await waitingOrder(student, buyablePack.id);
    const inbox = new Inbox(student.email);
    await inbox.mark();

    await signInAdmin(page, accounts);
    await page
      .getByRole('navigation', { name: 'Staff', exact: true })
      .getByRole('link', { name: 'Orders' })
      .click();

    // The queue is the first thing shown; a search finds the order by its code.
    const search = form(page, 'Search');
    await search.getByLabel('Search').fill(order.code.toLowerCase());
    await search.getByRole('button', { name: 'Search' }).click();
    const row = page.getByRole('row').filter({ hasText: order.code });
    await expect(row).toContainText('Waiting for verification');
    await expect(row).toContainText(student.email);
    await row.getByRole('link', { name: `Open order ${order.code}` }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: `Order ${order.code}` }),
    ).toBeVisible();
    await expect(page.getByText('FT2627900001')).toBeVisible();

    // The screenshot is private: it is shown when asked for.
    await expect(page.getByRole('img', { name: 'Screenshot of the transfer' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the screenshot' }).click();
    const image = page.getByRole('img', { name: 'Screenshot of the transfer' });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    // Less than the price cannot be confirmed; the admin rejects with a reason instead.
    const confirm = form(page, 'Confirm the payment');
    await confirm.getByLabel('Amount received (VND)').fill('498999');
    await expect(confirm.getByRole('button', { name: 'Confirm payment' })).toBeDisabled();
    const reject = form(page, 'Reject the payment');
    await reject.getByLabel('Reason for the student').fill('Only 300,000 arrived');
    await reject.getByRole('button', { name: 'Reject payment' }).click();
    await expectNotice(page, 'Order rejected. The student can send new proof.');
    await expect(page.getByText('Rejected: Only 300,000 arrived')).toBeVisible();
    expect((await student.api.order(order.id)).status).toBe('REJECTED');
    expect((await inbox.nextMessage()).Subject).toContain(order.code);

    // The student pays the rest and sends new proof; the order is waiting again.
    await student.api.sendProof(order.id, { bankReference: 'FT2627900002' });
    await page.reload();
    await expect(page.getByText('FT2627900002')).toBeVisible();
    await form(page, 'Confirm the payment')
      .getByRole('button', { name: 'Confirm payment' })
      .click();
    await expectNotice(page, 'Order confirmed: access runs until');
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(form(page, 'Confirm the payment')).toHaveCount(0);

    expect((await student.api.myEntitlements()).filter((e) => e.status === 'ACTIVE')).toEqual([
      expect.objectContaining({ examPackId: buyablePack.id }),
    ]);
    expect((await inbox.nextMessage()).Subject).toContain(order.code);
  });

  test('E2E-ORD-07 · The admin cancels an order with the refund of a part-payment', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const order = await waitingOrder(student, buyablePack.id);
    await signInAdmin(page, accounts);
    await page.goto(adminSite(`/orders/${order.id}`));

    const cancel = form(page, 'Cancel the order');
    const button = cancel.getByRole('button', { name: 'Cancel order', exact: true });
    await expect(button).toBeDisabled(); // a reason is needed
    await cancel.getByLabel('Reason the student is told').fill('The student stopped paying');
    await expect(button).toBeEnabled();

    await cancel.getByLabel('Give money back with the cancellation').check();
    await expect(button).toBeDisabled();
    for (const amount of ['0', '499001']) {
      await cancel.getByLabel('Amount (VND)').fill(amount);
      await expect(button).toBeDisabled();
    }
    // A valid amount alone is not enough: add a screenshot, the time or the bank reference.
    await cancel.getByLabel('Amount (VND)').fill('200000');
    await expect(button).toBeDisabled();
    await cancel.getByLabel('Bank reference').fill('FT2628011111');
    await cancel.getByLabel('Note').fill('Part-payment returned');
    await cancel.getByLabel('Screenshot of the transfer').setInputFiles(REFUND_SCREENSHOT);
    await expect(cancel.getByText('Screenshot ready: two-dots.png')).toBeVisible();
    await button.click();

    await expectNotice(page, 'Order cancelled.');
    await expect(page.getByText('Cancelled: The student stopped paying')).toBeVisible();
    await expect(page.getByText('FT2628011111')).toBeVisible();
    await expect(form(page, 'Cancel the order')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the refund screenshot' }).click();
    await expect(page.getByRole('img', { name: 'Screenshot of the refund' })).toBeVisible();

    const after = await student.api.order(order.id);
    expect(after.status).toBe('CANCELLED');
    expect(after.refund).toMatchObject({ amount: 200000, bankReference: 'FT2628011111' });

    // The queue no longer has it; the list of cancelled orders does.
    await page.goto(adminSite('/orders'));
    await expect(page.getByRole('row').filter({ hasText: order.code })).toHaveCount(0);
    await page.getByRole('form', { name: 'Search' }).getByLabel('Status').selectOption('CANCELLED');
    await expect(page.getByRole('row').filter({ hasText: order.code })).toBeVisible();
  });

  test('E2E-ORD-08 · An overpayment is refunded and the refund corrected', async ({
    page,
    accounts,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const order = await waitingOrder(student, buyablePack.id);
    await signInAdmin(page, accounts);
    await page.goto(adminSite(`/orders/${order.id}`));

    const confirm = form(page, 'Confirm the payment');
    await confirm.getByLabel('Amount received (VND)').fill('498999');
    await expect(confirm.getByRole('button', { name: 'Confirm payment' })).toBeDisabled();
    await confirm.getByLabel('Amount received (VND)').fill('600000');
    await confirm.getByRole('button', { name: 'Confirm payment' }).click();
    await expectNotice(page, 'Order confirmed');

    // A confirmed order cannot be cancelled; the excess can be refunded.
    await expect(form(page, 'Cancel the order')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
    const refund = form(page, 'Record the refund');
    const record = refund.getByRole('button', { name: 'Record the refund' });
    await expect(refund.getByText('More than zero and at most 101,000 VND.')).toBeVisible();
    for (const amount of ['', '0', '101001']) {
      await refund.getByLabel('Amount (VND)').fill(amount);
      await expect(record).toBeDisabled();
    }
    await refund.getByLabel('Amount (VND)').fill('101000');
    await expect(record).toBeDisabled(); // no screenshot, time or bank reference
    await refund.getByLabel('Amount (VND)').fill('100000');
    await refund.getByLabel('Bank reference').fill('FT2628011111');
    await refund.getByLabel('Screenshot of the transfer').setInputFiles(REFUND_SCREENSHOT);
    const inbox = new Inbox(student.email);
    await inbox.mark();
    await expect(refund.getByText('Screenshot ready: two-dots.png')).toBeVisible();
    await record.click();

    await expectNotice(page, 'Refund recorded. The student is e-mailed.');
    await expect(page.getByText('100,000 VND', { exact: true })).toBeVisible();
    await expect(form(page, 'Record the refund')).toHaveCount(0);
    expect((await student.api.order(order.id)).refund).toMatchObject({ amount: 100000 });
    expect((await inbox.nextMessage()).Subject).toContain(order.code);

    // A refund is recorded once: it is corrected.
    await page.getByRole('button', { name: 'Correct the refund' }).click();
    const correct = form(page, 'Correct the refund');
    await correct.getByLabel('Amount (VND)').fill('101000');
    await correct.getByLabel('Bank reference').fill('FT2628011112');
    await correct.getByRole('button', { name: 'Save the correction' }).click();
    await expectNotice(page, 'Refund corrected. The student is e-mailed.');
    await expect(page.getByText('FT2628011112')).toBeVisible();
    expect((await student.api.order(order.id)).refund).toMatchObject({
      amount: 101000,
      bankReference: 'FT2628011112',
    });
  });

  test('E2E-ORD-12 · Correct a misassigned entitlement', async ({
    page,
    accounts,
    admin,
    buyablePack,
  }) => {
    const student = await accounts.customer();
    const other = await newPack(admin, 'ACTIVE');
    const bought = await waitingOrder(student, buyablePack.id);
    await admin.confirmOrder(bought.id);

    await signInAdmin(page, accounts);
    await page.goto(adminSite(`/entitlements?userId=${student.id}`));

    // Move the entitlement to the other pack.
    await page.getByRole('button', { name: `Edit the entitlement to ${buyablePack.name}` }).click();
    const editRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Save', exact: true }) });
    await editRow.getByLabel('Exam pack').selectOption({ label: other.name });
    await editRow.getByRole('button', { name: 'Save', exact: true }).click();
    await expectNotice(page, 'Entitlement corrected.');
    await expect(page.getByRole('row').filter({ hasText: other.name })).toBeVisible();
    expect((await student.api.myEntitlements()).map((e) => e.examPackId)).toEqual([other.id]);

    // The student buys the first pack again; the entitlement cannot move back onto it.
    const again = await waitingOrder(student, buyablePack.id);
    await admin.confirmOrder(again.id);
    await page.reload();
    await page.getByRole('button', { name: `Edit the entitlement to ${other.name}` }).click();
    await editRow.getByLabel('Exam pack').selectOption({ label: buyablePack.name });
    await editRow.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await student.api.myEntitlements()).map((e) => e.examPackId).sort()).toEqual(
      [buyablePack.id, other.id].sort(),
    );
  });

  test('E2E-ORD-13 · A pack without exams: a warning, then it can be put on sale anyway', async ({
    page,
    accounts,
    admin,
  }) => {
    const pack = await newPack(admin, 'DRAFT');
    await signInAdmin(page, accounts);
    await page.goto(adminSite('/exam-packs'));

    await page.getByRole('button', { name: `Edit ${pack.name}` }).click();
    // The row that is being edited has the Status select (its button changes after the warning).
    const editRow = page.getByRole('row').filter({ has: page.getByLabel('Status') });
    await editRow.getByLabel('Status').selectOption({ label: 'On sale' });
    await editRow.getByRole('button', { name: 'Save', exact: true }).click();

    // A warning, and nothing changed.
    await expect(editRow.getByText('This exam pack has no exams yet')).toBeVisible();
    expect((await admin.examPacks()).find((p) => p.id === pack.id)?.status).toBe('DRAFT');

    // A warning, not a lock.
    await editRow.getByRole('button', { name: 'Put on sale anyway' }).click();
    await expectNotice(page, 'Exam pack updated.');
    expect((await admin.examPacks()).find((p) => p.id === pack.id)?.status).toBe('ACTIVE');

    // Students cannot buy it, though: there is nothing to practise.
    const student = await accounts.customer();
    await expect(student.api.buy(pack.id)).rejects.toMatchObject({
      status: 409,
      code: 'PACK_WITHOUT_EXAMS',
    });
  });
});
