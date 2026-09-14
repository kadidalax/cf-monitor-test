import { currentScheduledBudget, scheduledFetch, ScheduledBudgetExceeded } from './scheduled-budget.ts';

export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;
export const TELEGRAM_FETCH_TIMEOUT_MS = 5000;
const TELEGRAM_RESPONSE_MAX_BYTES = 64 * 1024;

type TelegramSendMessagePayload = {
  chat_id: string;
  text: string;
  parse_mode: 'HTML';
  disable_web_page_preview?: boolean;
};

export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramHtmlText(value: unknown): string {
  return escapeTelegramHtml(String(value ?? '').slice(0, TELEGRAM_MESSAGE_MAX_CHARS));
}

export async function isTelegramResponseSuccessful(response: Response): Promise<boolean> {
  if (!response.ok || !response.body) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    return false;
  }
  const budget = currentScheduledBudget();
  const reader = response.body.getReader();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<boolean> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > TELEGRAM_RESPONSE_MAX_BYTES) return false;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).ok === true);
  };
  try {
    budget?.ensureCanStart(0);
    const confirmed = await Promise.race([
      read(),
      new Promise<boolean>(resolve => {
        timeoutId = setTimeout(() => resolve(false), Math.min(
          TELEGRAM_FETCH_TIMEOUT_MS, budget?.remainingMs() ?? TELEGRAM_FETCH_TIMEOUT_MS,
        ));
      }),
    ]);
    if (budget?.remainingMs() === 0) throw new ScheduledBudgetExceeded();
    return confirmed;
  } catch (error) {
    if (error instanceof ScheduledBudgetExceeded || budget?.remainingMs() === 0) throw new ScheduledBudgetExceeded();
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    // Cancellation closes pending reads immediately; do not let an untrusted
    // stream's asynchronous cancel hook extend the response deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function sendTelegramMessage(botToken: string, payload: TelegramSendMessagePayload): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);
  try {
    return await scheduledFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
