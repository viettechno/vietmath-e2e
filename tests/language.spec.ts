import { publicApi } from '../support/api';
import { PASSWORD, uniqueEmail, uniquePhone } from '../support/data';
import { expect, test } from '../support/fixtures';
import { Inbox, mailAvailable } from '../support/mailpit';
import { signIn } from '../support/pages/auth';

test.describe('Interface language and accounts', () => {
  test.skip(!mailAvailable, 'needs Mailpit to read the e-mails');

  test('E2E-I18N-02 · The language is saved to the account and follows the user', async ({
    page,
    newBrowser,
    accounts,
  }) => {
    const student = await accounts.customer();
    await student.api.setLanguage('vi');
    const inbox = new Inbox(student.email);

    // Window A: signing in puts the app in the account's language; choosing English saves it.
    await signIn(page, student.email, student.password);
    await expect(page.getByRole('button', { name: 'Tiếng Việt' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goto('/account');
    await page.getByRole('button', { name: 'English' }).first().click();
    await expect(page.getByRole('button', { name: 'English' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(async () => (await student.api.me()).preferredLanguage).toBe('en');

    // Window B starts in Vietnamese and switches to the account's language after signing in.
    const other = await newBrowser();
    await other.goto('/login');
    await other.evaluate(() => window.localStorage.setItem('vietmath.lang', 'vi'));
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Đăng nhập' }).first()).toBeVisible();
    await other.getByLabel('Email').fill(student.email);
    await other.getByLabel('Mật khẩu', { exact: true }).fill(student.password);
    await other.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(other.getByRole('button', { name: 'English' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The e-mails follow the account's language.
    await inbox.mark();
    await publicApi.forgotPassword(student.email);
    expect((await inbox.nextCode()).subject).toBe('Your VietMath password reset code');

    // An account in Vietnamese gets Vietnamese e-mail. (A second code for the same address
    // would have to wait a minute, so this is another account.)
    const vietnamese = await accounts.customer();
    await vietnamese.api.setLanguage('vi');
    const vietnameseInbox = new Inbox(vietnamese.email);
    await vietnameseInbox.mark();
    await publicApi.forgotPassword(vietnamese.email);
    expect((await vietnameseInbox.nextCode()).subject).toBe('Mã đặt lại mật khẩu VietMath');
  });

  test('E2E-I18N-03 · New accounts take the language used when signing up', async ({
    page,
    newBrowser,
  }) => {
    // The UI in English: the verification e-mail is in English.
    const english = uniqueEmail('lang-en');
    const englishInbox = new Inbox(english);
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Minh Anh');
    await page.getByLabel('Email').fill(english);
    await page.getByLabel('Phone number').fill(uniquePhone());
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    expect((await englishInbox.nextCode()).subject).toBe('Your VietMath verification code');

    // The UI in Vietnamese: the e-mail is in Vietnamese.
    const vietnamese = uniqueEmail('lang-vi');
    const vietnameseInbox = new Inbox(vietnamese);
    const other = await newBrowser();
    await other.goto('/register');
    await other.evaluate(() => window.localStorage.setItem('vietmath.lang', 'vi'));
    await other.reload();
    await other.getByLabel('Họ và tên').fill('Minh Anh');
    await other.getByLabel('Email').fill(vietnamese);
    await other.getByLabel('Số điện thoại').fill(uniquePhone());
    await other.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await other.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    expect((await vietnameseInbox.nextCode()).subject).toBe('Mã xác thực VietMath của bạn');
  });
});
