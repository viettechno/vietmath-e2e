import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { apiURL } from './env';

/**
 * A small client for the VietMath REST API (vietmath-docs/docs/en/06_API_Specifications.md).
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
  parentId: string | null;
  depth: number;
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

export interface TemplateVariable {
  varName: string;
  varType: 'INT' | 'DECIMAL' | 'ENUM';
  minValue?: number | null;
  maxValue?: number | null;
  step?: number | null;
  allowedValues?: number[] | null;
}

export interface QuestionTemplate {
  variables: TemplateVariable[];
  constraints: string[];
  correctAnswerFormula: string;
  distractorFormulas: string[];
}

export interface TemplateVariant {
  values: Record<string, number>;
  promptTextEn: string;
  promptTextVi: string | null;
  correctAnswer: { en: string; vi: string };
  distractors: { en: string; vi: string }[];
}

export interface QuestionInput {
  topicIds: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  languageMode: 'EN' | 'EN_VI';
  promptTextEn: string | null;
  promptTextVi: string | null;
  promptImageUrl: string | null;
  isTemplate?: boolean;
  template?: QuestionTemplate | null;
  answerChoices: AnswerChoice[];
}

export interface Question extends QuestionInput {
  id: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
}

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/** A mock exam blueprint (API Specifications §8). */
export interface Blueprint {
  id: string;
  examPackIds: string[];
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  totalQuestions: number;
  timeLimitMinutes: number;
  topicDistribution: { topicId: string; count: number }[];
  difficultyDistribution: { difficulty: Difficulty; count: number; points: number }[];
  totalPoints: number;
}

export interface BlueprintInput {
  examPackIds: string[];
  name: string;
  totalQuestions: number;
  timeLimitMinutes: number;
  status?: Blueprint['status'];
  topicDistribution: { topicId: string; count: number }[];
  difficultyDistribution?: { difficulty: Difficulty; count: number; points?: number }[];
}

export interface Readiness {
  ready: boolean;
  poolSize: number;
  shortfalls: {
    kind: 'TOPIC' | 'DIFFICULTY' | 'COMBINATION';
    required: number;
    available: number;
  }[];
}

export type OrderStatus =
  'AWAITING_PAYMENT' | 'PENDING_VERIFICATION' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

/** An order of a student (API Specifications §9). */
export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  examPackId: string;
  amount: number;
  amountReceived: number | null;
  paymentDetails: { bankName: string; accountNumber: string; accountName: string };
  proofs: { id: string; hasImage: boolean }[];
  entitlementId: string | null;
  refund: { amount: number; bankReference: string | null } | null;
}

export interface ProofInput {
  imageKey?: string;
  transferredAt?: string;
  senderName?: string;
  bankReference?: string;
  note?: string;
}

export interface Entitlement {
  id: string;
  userId: string;
  examPackId: string;
  expiresAt: string;
  status: 'ACTIVE' | 'EXPIRED';
}

export interface PaymentDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  qrImageUrl: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
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
    { error?: { code: string; message: string; details?: Record<string, unknown> } } | undefined;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? res.statusText,
      body?.error?.details,
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
  /** Asks for a password-reset code; the answer is the same for an unknown address. */
  forgotPassword: (email: string) => call<unknown>('/auth/forgot-password', post({ email })),
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

  me = () => this.call<User>('/users/me');

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

  /** Creates an exam pack; it is always a draft (it has no exam yet). */
  createExamPack = (input: {
    gradeId: number;
    competitionId: string;
    price: number;
    validityMonths: number;
    name?: string;
  }) => this.call<ExamPack>('/exam-packs', post(input));

  updateExamPack = (
    id: string,
    input: { status?: PackStatus; price?: number; confirm?: boolean },
  ) => this.call<ExamPack>(`/exam-packs/${id}`, patch(input));

  /** Puts a pack on sale even if it has no exam yet (the warning is confirmed). */
  putOnSale = (id: string) => this.updateExamPack(id, { status: 'ACTIVE', confirm: true });

  createTopic = (input: { parentId?: string | null; nameEn: string; nameVi: string | null }) =>
    this.call<Topic>('/topics', post(input));

  updateTopic = (
    id: string,
    input: { nameEn?: string; nameVi?: string | null; parentId?: string | null },
  ) => this.call<Topic>(`/topics/${id}`, patch(input));

  deleteTopic = (id: string) => this.call<void>(`/topics/${id}`, { method: 'DELETE' });

  topics = () => this.call<Topic[]>('/topics');

  // Question bank

  createQuestion = (input: QuestionInput) => this.call<Question>('/questions', post(input));

  getQuestion = (id: string) => this.call<Question>(`/questions/${id}`);

  /** Searches the bank: `query` is the query string without the leading "?". */
  searchQuestions = (query: string) =>
    this.call<{ items: Question[]; total: number }>(`/questions?${query}`);

  previewTemplate = (input: {
    promptTextEn: string;
    promptTextVi?: string | null;
    template: QuestionTemplate;
    count?: number;
  }) => this.call<{ variants: TemplateVariant[] }>('/templates/preview', post(input));

  act = (
    id: string,
    action: 'submit-review' | 'approve' | 'request-changes' | 'archive' | 'restore',
    input: { note?: string } = {},
  ) => this.call<Question>(`/questions/${id}/${action}`, post(input));

  // Mock exam blueprints

  createBlueprint = (input: BlueprintInput) =>
    this.call<Blueprint>('/mock-exam-templates', post(input));

  readiness = (id: string) => this.call<Readiness>(`/mock-exam-templates/${id}/readiness`);

  // Payment details, orders and entitlements (Phase 5)

  savePaymentDetails = (input: PaymentDetails) =>
    this.call<PaymentDetails>('/payment-settings', { method: 'PUT', body: JSON.stringify(input) });

  paymentDetails = () => this.call<PaymentDetails>('/payment-settings');

  /** A student buys an exam pack: the open order for it, or a new one. */
  buy = (examPackId: string) => this.call<Order>('/orders', post({ examPackId }));

  order = (id: string) => this.call<Order>(`/orders/${id}`);

  /** My orders (a student), newest first. */
  orders = () => this.call<Order[]>('/orders/me');

  /** A student sends proof of a transfer (with a screenshot when imagePath is given). */
  sendProof = async (orderId: string, input: ProofInput = { bankReference: 'FT2627900000' }) =>
    this.call<Order>(`/orders/${orderId}/proofs`, post(input));

  /** Uploads a screenshot of a transfer for an order and returns the key to send with the proof. */
  uploadProofImage = async (orderId: string, path: string, type = 'image/png') => {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)], { type }), basename(path));
    return this.call<{ imageKey: string }>(`/orders/${orderId}/proofs/image`, {
      method: 'POST',
      body: form,
    });
  };

  cancelOrder = (id: string, reason: string) =>
    this.call<Order>(`/orders/${id}/cancel`, post({ reason }));

  confirmOrder = (id: string, amountReceived?: number) =>
    this.call<unknown>(
      `/orders/${id}/confirm`,
      post(amountReceived === undefined ? {} : { amountReceived }),
    );

  rejectOrder = (id: string, reason: string) =>
    this.call<unknown>(`/orders/${id}/reject`, post({ reason }));

  recordRefund = (id: string, input: { amount: number; bankReference?: string }) =>
    this.call<unknown>(`/orders/${id}/refund`, post(input));

  attemptResult = (id: string) =>
    this.call<{ score: number; totalPoints: number }>(`/attempts/${id}/result`);

  attempts = () => this.call<{ items: { attemptId: string; examPackId: string }[] }>('/attempts');

  entitlements = (query = '') => this.call<Entitlement[]>(`/entitlements${query}`);

  myEntitlements = () => this.call<Entitlement[]>('/entitlements/me');

  blueprints = () => this.call<Blueprint[]>('/mock-exam-templates');

  uploadImage = async (path: string, type: string) => {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)], { type }), basename(path));
    return this.call<{ url: string }>('/images/upload', { method: 'POST', body: form });
  };
}
