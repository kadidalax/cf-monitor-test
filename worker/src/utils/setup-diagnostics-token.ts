export const MIN_SETUP_DIAGNOSTICS_TOKEN_BYTES = 32;

export function validateSetupDiagnosticsToken(value: string | undefined): string | null {
  const token = value?.trim() || '';
  if (!token) return null;
  return new TextEncoder().encode(token).byteLength >= MIN_SETUP_DIAGNOSTICS_TOKEN_BYTES
    ? null
    : `SETUP_DIAGNOSTICS_TOKEN must be at least ${MIN_SETUP_DIAGNOSTICS_TOKEN_BYTES} bytes when configured`;
}
