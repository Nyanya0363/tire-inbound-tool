import type { ParsedTire } from './types';

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/　/g, ' ')
    .replace(/[／]/g, '/')
    .replace(/[×✕]/g, 'X')
    .replace(/[＊]/g, '*')
    .replace(/[－—]/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function compactText(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, '');
}

export function normalizeBrand(value: unknown): string {
  return compactText(value).replace(/[（）()]/g, '');
}

const SIZE_PATTERNS: RegExp[] = [
  // Flotation sizes such as 31*10.5R15LT / 33X12.50R20LT
  /\d{2}(?:\.\d{1,2})?\s*[X*]\s*\d{2}(?:\.\d{1,2})?\s*R\s*\d{2}(?:LT|C)?/,
  // Common metric sizes such as 165R14LT, 175/70R14, LT235/70R16, 235/50ZR20
  /(?:LT|P|ST)?\s*\d{3}(?:[\/\s]\d{2,3})?\s*(?:Z?R|X)\s*\d{2}(?:\.\d)?\s*(?:LT|C)?/,
  // Heavy truck sizes such as 7.00R16, 8.25R20
  /\d+(?:\.\d+)?\s*R\s*\d{2}(?:LT|C)?/,
];

export function extractSize(text: string): string | undefined {
  let normalized = normalizeText(text);
  // Product codes often use H235/50ZR20 where H is a series marker, not part of the size.
  normalized = normalized.replace(/\bH(?=\d{3}(?:[\/\s]\d{2,3})?\s*(?:Z?R|X)\s*\d{2})/g, '');
  for (const pattern of SIZE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return match[0]
        .replace(/\s+/g, '')
        .replace(/[（(].*?[）)]/g, '')
        .replace(/^H(?=\d{3})/, '');
    }
  }
  return undefined;
}

export function extractPly(text: string): string | undefined {
  // Allow "8PR", "8 PR", and "8PRHD517" but not "HD877 PRO".
  const match = normalizeText(text).match(/(?<!\d)(\d{1,2})\s*PR(?!O)/);
  return match ? `${match[1]}PR` : undefined;
}

export function extractPattern(text: string): { pattern: string; flags: string[] } | undefined {
  const normalized = normalizeText(text);
  const match = normalized.match(/\bHD\s*\d+[A-Z]*/);
  const snow = normalized.match(/\bSNOW\s*PIONEER\b/);

  if (!match && !snow) return undefined;

  let pattern = match ? match[0].replace(/\s+/g, '') : 'SNOWPIONEER';
  const flags: string[] = [];

  if (match) {
    // HD302 EVT / HD665 EV / HD927 SP: the suffix belongs to the pattern.
    const after = normalized.slice((match.index ?? 0) + match[0].length);
    const suffix = after.match(/^\s*(EVT|EV|SP)\b/);
    if (suffix) pattern += suffix[1];
  }

  // HD877 Pro: PRO is a description flag, not part of the product pattern.
  if (pattern.endsWith('PRO')) {
    pattern = pattern.slice(0, -3);
    flags.push('PRO');
  }

  // HD665 EV: EV is a real pattern suffix in the HAIDA catalog.
  if (/\bEV\b/.test(normalized) && !pattern.endsWith('EV')) {
    pattern += 'EV';
  }

  return { pattern, flags };
}

export function extractLoadSpeed(text: string): string | undefined {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])\b/);
  return match ? `${match[1]}${match[2]}` : undefined;
}

export function extractFlags(text: string): string[] {
  const normalized = normalizeText(text);
  const flags: string[] = [];
  if (normalized.includes('XL')) flags.push('XL');
  if (normalized.includes('白字') || normalized.includes('白')) flags.push('WHITE');
  if (normalized.includes('PRO')) flags.push('PRO');
  if (normalized.includes('增强型')) flags.push('ENHANCED');
  if (normalized.includes('低滚阻')) flags.push('LOW_ROLL');
  if (normalized.includes('左')) flags.push('LEFT');
  if (normalized.includes('右')) flags.push('RIGHT');
  return Array.from(new Set(flags));
}

export function removeToken(text: string, token?: string): string {
  if (!token) return text;
  return text.replace(token, ' ');
}

export function makeExactKey(parsed: ParsedTire): string {
  return [
    normalizeBrand(parsed.brand),
    parsed.pattern,
    parsed.size,
    parsed.ply ?? '',
    parsed.loadSpeed ?? '',
    [...parsed.flags].sort().join(','),
  ].join('|');
}

export function makeCoreKey(parsed: ParsedTire): string {
  return [
    normalizeBrand(parsed.brand),
    parsed.pattern,
    parsed.size,
    parsed.ply ?? '',
  ].join('|');
}

export function makeCoreFlagsKey(parsed: ParsedTire): string {
  return [
    normalizeBrand(parsed.brand),
    parsed.pattern,
    parsed.size,
    parsed.ply ?? '',
    [...parsed.flags].sort().join(','),
  ].join('|');
}

export function makeSizePatternKey(parsed: ParsedTire): string {
  return [normalizeBrand(parsed.brand), parsed.pattern, parsed.size].join('|');
}
