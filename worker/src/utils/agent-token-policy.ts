const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGENT_TOKEN_MAX_AGE_DAYS = 3650;

export type AgentTokenPolicyEnv = {
  AGENT_TOKEN_MAX_AGE_DAYS?: string;
};

export type AgentTokenTimestampSource = {
  token_rotated_at?: string | null;
  created_at?: string | null;
};

function parseTimeMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getAgentTokenMaxAgeMs(env: AgentTokenPolicyEnv): number {
  const raw = env.AGENT_TOKEN_MAX_AGE_DAYS?.trim();
  if (!raw) return 0;
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) return 0;
  return Math.min(days, MAX_AGENT_TOKEN_MAX_AGE_DAYS) * DAY_MS;
}

export function isAgentTokenMaxAgeConfigInvalid(env: AgentTokenPolicyEnv): boolean {
  const raw = env.AGENT_TOKEN_MAX_AGE_DAYS?.trim();
  if (!raw) return false;
  const days = Number(raw);
  return !Number.isInteger(days) || days <= 0;
}

export function isAgentTokenExpired(
  client: AgentTokenTimestampSource,
  maxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  if (maxAgeMs <= 0) return false;
  const issuedAt = parseTimeMs(client.token_rotated_at) || parseTimeMs(client.created_at);
  if (!issuedAt) return true;
  return nowMs - issuedAt > maxAgeMs;
}
