export const MIN_NEW_PASSWORD_CHARACTERS = 15;
export const NEW_PASSWORD_GUIDANCE = `新密码至少 ${MIN_NEW_PASSWORD_CHARACTERS} 个字符，建议使用易记的长短语。`;

export function hasValidNewPasswordLength(value: string): boolean {
  return Array.from(value).length >= MIN_NEW_PASSWORD_CHARACTERS;
}
