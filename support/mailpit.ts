import { expect } from '@playwright/test';
import { env } from './env';

interface MailpitMessage {
  ID: string;
  Subject: string;
  Snippet: string;
  Created: string;
}

interface SearchResult {
  total: number;
  messages: MailpitMessage[];
}

/**
 * The Mailpit of a staging sits behind a login: E2E_MAILPIT_URL may carry it as
 * https://user:password@host. fetch refuses credentials in a URL, so they go in a header.
 */
export function mailpitRequest(path: string): { url: string; headers: Record<string, string> } {
  const url = new URL(env.mailpitURL + path);
  const headers: Record<string, string> = {};
  if (url.username) {
    const login = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(login).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  return { url: url.toString(), headers };
}

async function search(address: string): Promise<SearchResult> {
  const query = encodeURIComponent(`to:"${address}"`);
  const request = mailpitRequest(`/api/v1/search?query=${query}&limit=50`);
  const res = await fetch(request.url, { headers: request.headers });
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return (await res.json()) as SearchResult;
}

/** The Mailpit address without its login, for messages. */
export function mailpitAddress(): string {
  const url = new URL(env.mailpitURL);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/$/, '');
}

/** Whether the tests can read emails (a Mailpit URL is configured). */
export const mailAvailable = env.mailpitURL !== '';

/**
 * The mailbox of one address in Mailpit. Call mark() before the action that
 * sends an email, then nextMessage()/nextCode() for the email it sent.
 */
export class Inbox {
  private seen = 0;

  constructor(readonly address: string) {}

  /** Remembers how many emails are there now; later reads return newer ones. */
  async mark(): Promise<void> {
    this.seen = (await search(this.address)).total;
  }

  async nextMessage(): Promise<MailpitMessage> {
    let message: MailpitMessage | undefined;
    await expect
      .poll(
        async () => {
          const result = await search(this.address);
          // Newest first.
          message = result.total > this.seen ? result.messages[0] : undefined;
          return message !== undefined;
        },
        { message: `an email to ${this.address}`, timeout: 20_000 },
      )
      .toBe(true);
    this.seen += 1;
    return message as MailpitMessage;
  }

  /** The 6-digit code in the next email. */
  async nextCode(): Promise<{ code: string; subject: string }> {
    const message = await this.nextMessage();
    const code = /\b(\d{6})\b/.exec(message.Snippet)?.[1];
    if (!code) throw new Error(`No 6-digit code in email "${message.Subject}"`);
    return { code, subject: message.Subject };
  }
}
