import type { BrandAdapter } from '../types';
import type { ParsedTire, Product } from '../../core/types';
import {
  extractFlags,
  extractLoadSpeed,
  extractPattern,
  extractPly,
  extractSize,
  normalizeText,
  removeToken,
} from '../../core/text';

const BRAND = '海大';
const ADAPTER_VERSION = 'haida-1';

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parsePatternFromCode(code: string): { pattern: string; flags: string[] } | null {
  const compact = normalizeText(code).replace(/\s+/g, '');
  const prefix = compact.split('-')[0] ?? '';
  const match = prefix.match(/^HD\d+[A-Z]*/);
  if (!match) return null;

  let pattern = match[0];
  const flags: string[] = [];
  if (pattern.endsWith('PRO')) {
    pattern = pattern.slice(0, -3);
    flags.push('PRO');
  }
  return { pattern, flags };
}

function parseInbound(raw: string, brand = BRAND): ParsedTire {
  const normalized = normalizeText(raw);
  const clean = normalized.replace(/\bHAIDA\b/g, ' ').replace(/海大/g, ' ');
  const size = extractSize(clean);
  const patternMatch = extractPattern(clean);
  const ply = extractPly(clean);
  if (!size || !patternMatch) {
    throw new Error(`无法解析型号：${raw}`);
  }

  let rest = clean;
  rest = removeToken(rest, size);
  rest = removeToken(rest, ply);
  rest = removeToken(rest, patternMatch.pattern);
  // If the pattern came from "HD665 EV", the compact pattern is HD665EV and
  // the original text still contains "HD665". Remove the base token as well.
  rest = removeToken(rest, patternMatch.pattern.replace(/EV$/, ''));

  const loadSpeed = extractLoadSpeed(rest);
  const flags = unique([...patternMatch.flags, ...extractFlags(clean)]);

  return {
    brand,
    pattern: patternMatch.pattern,
    size,
    ply,
    loadSpeed,
    flags,
    raw: normalized,
  };
}

function parseProduct(product: Product): ParsedTire | null {
  const code = normalizeText(product.code);
  const spec = normalizeText(product.spec);
  const patternFromCode = parsePatternFromCode(code);
  const patternFromSpec = extractPattern(spec);
  let pattern = patternFromCode?.pattern ?? patternFromSpec?.pattern;
  // The product code often contains the base pattern (HD927) while the spec
  // contains the variant suffix (HD927SP). Prefer the more specific one.
  if (
    patternFromCode?.pattern &&
    patternFromSpec?.pattern &&
    patternFromSpec.pattern.startsWith(patternFromCode.pattern) &&
    patternFromSpec.pattern.length > patternFromCode.pattern.length
  ) {
    pattern = patternFromSpec.pattern;
  }
  if (!pattern) return null;

  const size = extractSize(code) ?? extractSize(spec);
  if (!size) return null;

  const ply = extractPly(spec) ?? extractPly(code);
  const loadSpeed = extractLoadSpeed(
    [spec.replace(pattern, ' '), code.replace(pattern, ' ')].join(' '),
  );

  const flags = unique([
    ...(patternFromCode?.flags ?? []),
    ...(patternFromSpec?.flags ?? []),
    ...extractFlags(`${code} ${spec}`),
  ]);

  return {
    brand: product.brand || BRAND,
    pattern,
    size,
    ply,
    loadSpeed,
    flags,
    raw: `${code} ${spec}`.trim(),
  };
}

export const haidaAdapter: BrandAdapter = {
  id: 'haida',
  label: BRAND,
  supplierName: '四川海大轮胎橡胶集团股份有限公司',
  version: ADAPTER_VERSION,
  brandAliases: ['海大', 'HAIDA'],
  inputAliases: {
    model: ['规格', '型号', '产品型号', '规格/型号', '轮胎型号'],
    qty: ['数量', '入库数量'],
    price: ['价格', '单价', '底价', '含税单价'],
    unit: ['单位'],
    brand: ['品牌', '厂家', '工厂'],
  },
  parseInbound,
  parseProduct,
};
