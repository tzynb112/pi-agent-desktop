const DEFAULT_DANGEROUS_KEYWORDS = [
  'rm',
  'del',
  'format',
  'rd',
  'rmdir',
  'shutdown',
  'remove-item',
  'removeitem',
  'taskkill',
  'stop-process',
  'stopprocess',
  'kill',
  'pkill',
  'killall',
  'erase',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordPattern(keyword: string): RegExp | null {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return null;

  const parts = normalized.split('-').map(escapeRegExp);
  const body = parts.join('[-\\s]?');
  return new RegExp(`(^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
}

export function getDangerousKeywords(rawKeywords?: string): string[] {
  const customKeywords = (rawKeywords || '')
    .split(/[,\r\n]+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_DANGEROUS_KEYWORDS, ...customKeywords]));
}

export function findDangerousCommandMatch(command: string, rawKeywords?: string): string | null {
  const keywords = getDangerousKeywords(rawKeywords);
  const normalizedCommand = command.toLowerCase();

  for (const keyword of keywords) {
    const pattern = buildKeywordPattern(keyword);
    if (pattern && pattern.test(normalizedCommand)) {
      return keyword;
    }
  }

  return null;
}
