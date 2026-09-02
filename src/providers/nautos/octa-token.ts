function isOctaToken(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const lowercase = code >= 97 && code <= 102;
    const uppercase = code >= 65 && code <= 70;
    if (!digit && !lowercase && !uppercase) return false;
  }
  return true;
}

export function extractOctaToken(value: unknown): string | null {
  if (typeof value === 'object' && value !== null
    && 'octaToken' in value && typeof value.octaToken === 'string') {
    return value.octaToken;
  }
  const text = String(value);
  for (let index = 0; index < text.length - 64; index++) {
    if (text[index] !== ':') continue;
    const candidate = text.slice(index + 1, index + 65);
    if (isOctaToken(candidate)) return candidate;
  }
  return null;
}
