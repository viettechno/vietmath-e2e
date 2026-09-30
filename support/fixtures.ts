import { test as base, expect, type BrowserContextOptions, type Page } from '@playwright/test';
import { Api, publicApi, type ExamPack, type Lang, type StaffRole, type Topic } from './api';
import { PASSWORD, unique, uniqueEmail, uniquePhone } from './data';
import { env } from './env';
import { withLock } from './lock';
import { Inbox, mailAvailable } from './mailpit';

/** An account made for one test. */
export interface Account {
  id: string;
  email: string;
  password: string;
  fullName: string;
  phone: string;
  /** The same user through the API, signed in on the MOBILE slot. */
  api: Api;
}

interface WorkerFixtures {
  /** A System Admin of this worker's own, made from E2E_ADMIN_EMAIL. */
  admin: Api;
  /** The "ASMO Grade 1" exam pack (on sale), shared by the question tests. */
  asmoPack: ExamPack;
}

interface TestFixtures {
  /**
   * The interface language a new browser starts with. Most tests read the
   * English labels; null keeps the app's own default (Vietnamese).
   */
  uiLanguage: Lang | null;
  /** New, unique accounts for this test. */
  accounts: {
    staff: (role: StaffRole) => Promise<Account>;
    /** A verified student or parent; needs Mailpit for the email code. */
    customer: (type?: 'STUDENT' | 'PARENT') => Promise<Account>;
  };
  /** New topics for a competition (default: the ASMO pack's), unique to this test. */
  newTopic: (competitionId?: string | null) => Promise<Topic>;
  /** Another browser (e.g. a second computer or a phone), closed after the test. */
  newBrowser: (options?: BrowserContextOptions) => Promise<Page>;
}

const LANG_KEY = 'vietmath.lang';

export const test = base.extend<TestFixtures, WorkerFixtures>({
  uiLanguage: ['en', { option: true }],

  admin: [
    async ({}, use) => {
      const email = uniqueEmail('admin');
      await withLock('root-admin', async () => {
        const root = await Api.login(env.adminEmail, env.adminPassword);
        await root.createStaff({
          email,
          fullName: `E2E Admin ${process.env.TEST_WORKER_INDEX}`,
          phoneNumber: uniquePhone(),
          staffRole: 'SYSTEM_ADMIN',
          password: PASSWORD,
        });
      });
      const admin = await Api.login(email, PASSWORD);
      await admin.setLanguage('en');
      await use(admin);
    },
    { scope: 'worker' },
  ],

  asmoPack: [
    async ({ admin }, use) => {
      const pack = await withLock('asmo-pack', async () => {
        const found = (await admin.examPacks()).find(
          (p) => p.grade.id === 1 && p.competition.code === 'ASMO',
        );
        if (found) return found;
        const asmo = (await publicApi.competitions(1)).find((c) => c.code === 'ASMO');
        if (!asmo) throw new Error('ASMO is not a Grade 1 competition');
        return admin.createExamPack({
          gradeId: 1,
          competitionId: asmo.id,
          price: 499000,
          validityMonths: 12,
          status: 'ACTIVE',
        });
      });
      await use(pack);
    },
    { scope: 'worker' },
  ],

  page: async ({ page, uiLanguage }, use) => {
    await setLanguage(page, uiLanguage);
    await use(page);
  },

  accounts: async ({ admin }, use) => {
    const signIn = async (email: string, id: string, fullName: string, phone: string) => {
      const api = await Api.login(email, PASSWORD);
      // Signed-in users see the app in their account's language.
      await api.setLanguage('en');
      return { id, email, password: PASSWORD, fullName, phone, api };
    };

    await use({
      staff: async (role) => {
        const email = uniqueEmail(role.toLowerCase().replace('_', '-'));
        const fullName = `${roleName[role]} ${unique('e2e')}`;
        const phone = uniquePhone();
        const user = await admin.createStaff({
          email,
          fullName,
          phoneNumber: phone,
          staffRole: role,
          password: PASSWORD,
        });
        return signIn(email, user.id, fullName, phone);
      },
      customer: async (type = 'STUDENT') => {
        if (!mailAvailable) throw new Error('E2E_MAILPIT_URL is needed to verify new accounts');
        const email = uniqueEmail(type.toLowerCase());
        const fullName = `${type === 'STUDENT' ? 'Student' : 'Parent'} ${unique('e2e')}`;
        const phone = uniquePhone();
        const inbox = new Inbox(email);
        const { userId } = await publicApi.register({
          email,
          password: PASSWORD,
          phoneNumber: phone,
          fullName,
          accountType: type,
          preferredLanguage: 'en',
        });
        const { code } = await inbox.nextCode();
        await publicApi.verifyEmail(userId, code);
        return signIn(email, userId, fullName, phone);
      },
    });
  },

  newTopic: async ({ admin, asmoPack }, use) => {
    await use((competitionId = asmoPack.competition.id) => {
      const name = unique('Topic');
      return admin.createTopic({ competitionId, nameEn: name, nameVi: `${name} (vi)` });
    });
  },

  newBrowser: async ({ browser, uiLanguage }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext(options);
      contexts.push(context);
      const page = await context.newPage();
      await setLanguage(page, uiLanguage);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

const roleName: Record<StaffRole, string> = {
  SYSTEM_ADMIN: 'Admin',
  CONTENT_CREATOR: 'Creator',
  REVIEWER: 'Reviewer',
};

/** Starts the app in lang, unless the page already chose a language. */
async function setLanguage(page: Page, lang: Lang | null) {
  if (!lang) return;
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        // No storage: the app falls back to Vietnamese.
      }
    },
    [LANG_KEY, lang] as const,
  );
}

export { expect };
