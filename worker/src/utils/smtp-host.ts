import { validateWebhookUrl } from './webhook.ts';

/** Optional settings may be empty; sending additionally requires a nonempty host. */
export function normalizeSmtpHost(value: unknown): string | null {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  // SMTP configuration accepts a hostname or IPv4, with the port in its own field.
  if (!host || /[\s/@:?#\\]/.test(host)) return null;
  const validated = validateWebhookUrl(`https://${host}/`);
  // Reject ambiguous numeric forms that URL parsing would silently rewrite.
  return validated.ok && validated.host === host ? host : null;
}
