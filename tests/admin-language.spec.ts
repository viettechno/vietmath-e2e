import { type Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { adminSite, signInStaff } from '../support/pages/auth';

/** The words of the interface on the page: headings, navigation, buttons and labels. Not the data. */
async function chrome(page: Page): Promise<string> {
  return page
    .locator('h1, h2, h3, nav a, button, label, legend, th')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText).join('\n'));
}

// Letters that only Vietnamese uses.
const VIETNAMESE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
// Words of the English interface that would show a string left untranslated.
const ENGLISH =
  /\b(Question bank|Review queue|Exam packs|Content gaps|Save changes|Sign out|Loading|Search)\b/;

test.describe('The admin web is translated', () => {
  for (const language of ['vi', 'en'] as const) {
    test(`E2E-I18N-04 · The admin web in ${language === 'vi' ? 'Vietnamese' : 'English'}`, async ({
      page,
      accounts,
    }) => {
      const admin = await accounts.staff('SYSTEM_ADMIN');
      await admin.api.setLanguage(language);
      await signInStaff(page, admin.email, admin.password);

      const nav = page.getByRole('navigation', {
        name: language === 'vi' ? 'Điều hướng nhân viên' : 'Staff',
        exact: true,
      });
      const links = await nav
        .getByRole('link')
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
        );
      expect(links.length).toBeGreaterThan(3);

      for (const href of links as string[]) {
        await page.goto(adminSite(href));
        await expect(page.getByRole('heading').first()).toBeVisible();
        const text = await chrome(page);

        if (language === 'vi') {
          expect(text, `${href} has English left`).not.toMatch(ENGLISH);
          expect(text, `${href} has Vietnamese`).toMatch(VIETNAMESE);
        } else {
          expect(text, `${href} has Vietnamese left`).not.toMatch(VIETNAMESE);
        }
      }
    });
  }
});
