import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { apiURL } from './env';

/**
 * A small client for the VietMath REST API (vietmath-docs/06_API_Specifications.md).
 * Tests use it to set up data quickly; the behaviour under test goes through
 * the browser.
 */

export type DeviceType = 'PC' | 'MOBILE';
export type StaffRole = 'SYSTEM_ADMIN' | 'CONTENT_CREATOR' | 'REVIEWER';
export type Lang = 'vi' | 'en';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  accountType: 'STUDENT' | 'PARENT' | 'STAFF';
  staffRole: StaffRole | null;
  status: 'ACTIVE' | 'DISABLED';
  preferredLanguage: Lang;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken?: string;
  user: User;
}

export interface Competition {
  id: string;
  code: string;
  name: string;
}

export interface Topic {
  id: string;
  competitionId: string | null;
  nameEn: string;
  nameVi: string | null;
}

export type PackStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface ExamPack {
  id: string;
  name: string;
  grade: { id: number };
  competition: Competition;
  price: number;
  validityMonths: number;
  status: PackStatus;
}

export interface AnswerChoice {
  label: string;
  contentTextEn: string | null;
  contentTextVi: string | null;
  contentImageUrl: string | null;
  isCorrect: boolean;
}

export interface QuestionInput {
  examPackId: string;
  examType: 'MOCK' | 'REAL';
  topicIds: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  languageMode: 'EN' | 'EN_VI';
  promptTextEn: string | null;
  promptTextVi: string | null;
  promptImageUrl: string | null;
  answerChoices: AnswerChoice[];
}

export interface Question extends QuestionInput {
  id: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { token?: string; lang?: Lang } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Accept-Language', init.lang ?? 'en');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  const res = await fetch(`${apiURL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => undefined)) as
    { error?: { code: string; message: string } } | undefined;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? res.statusText,
    );
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });

/** Calls that need no account. */
export const publicApi = {
  hello: () => call<{ message: string; version: string }>('/hello'),
  competitions: (gradeId?: number) =>
    call<Competition[]>(gradeId ? `/competitions?gradeId=${gradeId}` : '/competitions'),
  /** Only exam packs on sale are listed for the public. */
  examPacks: () => call<ExamPack[]>('/exam-packs'),
  register: (input: {
    email: string;
    password: string;
    phoneNumber: string;
    fullName: string;
    accountType: 'STUDENT' | 'PARENT';
    preferredLanguage?: Lang;
  }) => call<{ userId: string; otpSentTo: string }>('/auth/register', post(input)),
  verifyEmail: (userId: string, otpCode: string, deviceType: DeviceType = 'MOBILE') =>
    call<AuthResponse>('/auth/register/verify-otp', post({ userId, otpCode, deviceType })),
  login: (email: string, password: string, deviceType: DeviceType = 'MOBILE') =>
    call<AuthResponse>('/auth/login', post({ email, password, deviceType })),
};

/** Calls made as a signed-in user. */
export class Api {
  constructor(
    readonly token: string,
    readonly user: User,
  ) {}

  /**
   * Signs in on the MOBILE slot by default, so a browser test signed in as
   * the same user (a computer) keeps its session.
   */
  static async login(email: string, password: string, deviceType: DeviceType = 'MOBILE') {
    const auth = await publicApi.login(email, password, deviceType);
    return new Api(auth.accessToken, auth.user);
  }

  private call<T>(path: string, init: RequestInit = {}) {
    return call<T>(path, { ...init, token: this.token });
  }

  // Users

  setLanguage = (preferredLanguage: Lang) =>
    this.call<User>('/users/me', patch({ preferredLanguage }));

  createStaff = (input: {
    email: string;
    fullName: string;
    phoneNumber: string;
    staffRole: StaffRole;
    password: string;
  }) => this.call<User>('/users', post(input));

  updateUser = (id: string, input: { fullName?: string; staffRole?: StaffRole; status?: string }) =>
    this.call<User>(`/users/${id}`, patch(input));

  // Catalog

  examPacks = () => this.call<ExamPack[]>('/exam-packs');

  createExamPack = (input: {
    gradeId: number;
    competitionId: string;
    price: number;
    validityMonths: number;
    status: PackStatus;
    name?: string;
  }) => this.call<ExamPack>('/exam-packs', post(input));

  updateExamPack = (id: string, input: { status?: PackStatus; price?: number }) =>
    this.call<ExamPack>(`/exam-packs/${id}`, patch(input));

  createTopic = (input: { competitionId: string | null; nameEn: string; nameVi: string | null }) =>
    this.call<Topic>('/topics', post(input));

  // Question bank

  createQuestion = (input: QuestionInput) => this.call<Question>('/questions', post(input));

  getQuestion = (id: string) => this.call<Question>(`/questions/${id}`);

  act = (
    id: string,
    action: 'submit-review' | 'approve' | 'request-changes' | 'archive' | 'restore',
    input: { note?: string } = {},
  ) => this.call<Question>(`/questions/${id}/${action}`, post(input));

  uploadImage = async (path: string, type: string) => {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)], { type }), basename(path));
    return this.call<{ url: string }>('/images/upload', { method: 'POST', body: form });
  };
}
