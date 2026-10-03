import { expect, type Page } from '@playwright/test';
import type { AnswerChoice, QuestionInput } from '../api';

/** The question editor (new question page, and the question page when editable). */
export class QuestionEditor {
  constructor(readonly page: Page) {}

  async classify(o: {
    pack: string;
    topics: string[];
    difficulty?: 'Easy' | 'Medium' | 'Hard';
    language?: 'English' | 'English + Vietnamese';
  }) {
    const { page } = this;
    await page.getByLabel('Exam pack').selectOption({ label: o.pack });
    for (const topic of o.topics) await page.getByRole('checkbox', { name: topic }).check();
    await page.getByLabel('Difficulty').selectOption({ label: o.difficulty ?? 'Easy' });
    // "Language" alone also matches the interface language switcher.
    await page
      .getByRole('combobox', { name: 'Language' })
      .selectOption({ label: o.language ?? 'English' });
  }

  /** Uploads an image for "Illustration" or "Image for answer X" and waits for it. */
  async upload(field: string, path: string) {
    await this.page.getByLabel(`${field}: Add image`).setInputFiles(path);
    await expect(this.page.getByLabel(`${field}: Replace image`)).toBeAttached({ timeout: 20_000 });
  }

  async choiceCount(n: number) {
    await this.page.getByLabel('Number of answer choices').selectOption(String(n));
  }

  async markCorrect(label: string) {
    await this.page.getByRole('radio', { name: `Answer ${label} is correct` }).check();
  }
}

/** The status badge next to the question page's heading. */
export function statusBadge(page: Page) {
  return page
    .getByRole('heading', { level: 1, name: 'Question', exact: true })
    .locator('xpath=following-sibling::span');
}

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A question for API set-up: English text, n text answers, A correct. */
export function textQuestion(
  examPackId: string,
  topicIds: string[],
  prompt: string,
  o: Partial<QuestionInput> & { choices?: number } = {},
): QuestionInput {
  const { choices = 4, ...rest } = o;
  const answerChoices: AnswerChoice[] = LABELS.slice(0, choices).map((label, i) => ({
    label,
    contentTextEn: `${i + 1} o'clock`,
    contentTextVi: null,
    contentImageUrl: null,
    isCorrect: i === 0,
  }));
  return {
    examPackId,
    topicIds,
    difficulty: 'EASY',
    languageMode: 'EN',
    promptTextEn: prompt,
    promptTextVi: null,
    promptImageUrl: null,
    answerChoices,
    ...rest,
  };
}
