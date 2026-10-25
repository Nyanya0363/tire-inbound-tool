import type { BrandAdapter } from '../types';
import type { ParsedTire, Product } from '../../core/types';
import {
  extractFlags,
  extractLoadSpeedToken,
  extractPattern,
  extractPly,
  extractPlyToken,
  extractSize,
  extractSizeToken,
  normalizeText,
  normalizeBrand,
  removeToken,
} from '../../core/text';

const BRAND = '海大';
const ADAPTER_VERSION = 'haida-5';

function canonicalBrand(value: string): string {
  const brand = normalizeBrand(value);
  if (brand === 'HAIDA') return BRAND;
  if (brand === 'TIANFU') return '天府';
  return brand;
}

function extractSupplierPattern(text: string) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:MK\s*\d+[A-Z]*|TF\s*\d+[A-Z]*|RD\s*-?\s*\d+[A-Z]*|HI[\s-]*SPIRIT|EX[\s-]*COMFORT|RUN[\s-]*SPIRIT)/);
  if (!match) return extractPattern(text);
  let pattern = match[0].replace(/\s+/g, '').replace(/^RD-?/, 'RD-');
  pattern = pattern.replace(/^HI-?SPIRIT$/, 'HI-SPIRIT').replace(/^EX-?COMFORT$/, 'EX-COMFORT').replace(/^RUN-?SPIRIT$/, 'RUNSPIRIT');
  const after = normalized.slice((match.index ?? 0) + match[0].length);
  const suffix = after.match(/^[\s-]*(EVT|EV|SP)\b/);
  if (suffix && !pattern.endsWith(suffix[1])) pattern += suffix[1];
  if (/\bEV\b/.test(normalized) && !/(?:EVT|EV)$/.test(pattern)) pattern += 'EV';
  const flags: string[] = [];
  if (pattern.endsWith('PRO')) {
    pattern = pattern.slice(0, -3);
    flags.push('PRO');
  }
  return { pattern, flags };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function removePattern(text: string, pattern: string): string {
  const base = pattern.replace(/(?:EVT|EV|SP)$/, '');
  const expression = base.split('').map(char => char === '-' ? '[-\\s]*'
    : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*');
  return text.replace(new RegExp(expression), ' ');
}

function parsePatternFromCode(code: string): { pattern: string; flags: string[] } | null {
  const compact = normalizeText(code).replace(/\s+/g, '');
  const prefix = compact.split('-')[0] ?? '';
  const match = prefix.match(/^(?:HD|MK)\d+[A-Z]*/);
  if (!match) return null;

  let pattern = match[0];
  const flags: string[] = [];
  if (pattern.endsWith('PRO')) {
    pattern = pattern.slice(0, -3);
    flags.push('PRO');
  }
  return { pattern, flags };
}

function parseInbound(raw: string, brand?: string): ParsedTire {
  const normalized = normalizeText(raw);
  const embeddedBrand = /\bMILEKING\b|迈劲/.test(normalized) ? '迈劲'
    : /\bTIANFU\b|天府/.test(normalized) ? '天府'
    : /\bHAIDA\b|海大/.test(normalized) ? BRAND : undefined;
  const issues = brand && embeddedBrand && canonicalBrand(brand) !== embeddedBrand
    ? [`厂家型号品牌 ${embeddedBrand} 与品牌列 ${canonicalBrand(brand)} 冲突`] : [];
  const clean = normalized.replace(/\b(?:HAIDA|TIANFU|MILEKING)\b|海大|天府|迈劲/g, ' ')
    .replace(/\bH(?=\d{3})/g, '');
  const patternMatch = extractSupplierPattern(clean);
  const sizeToken = extractSizeToken(patternMatch ? removePattern(clean, patternMatch.pattern) : clean);
  const size = sizeToken?.value;
  const plyToken = extractPlyToken(clean, sizeToken);
  const ply = plyToken?.value;
  if (!size || !patternMatch) {
    throw new Error(`无法解析型号：${raw}`);
  }

  let rest = removePattern(clean, patternMatch.pattern);
  rest = removeToken(rest, sizeToken?.raw);
  rest = removeToken(rest, plyToken?.raw);
  rest = removeToken(rest, patternMatch.pattern);
  // If the pattern came from "HD665 EV", the compact pattern is HD665EV and
  // the original text still contains "HD665". Remove the base token as well.
  rest = removeToken(rest, patternMatch.pattern.replace(/EV$/, ''));

  const loadSpeedToken = extractLoadSpeedToken(rest);
  const loadSpeed = loadSpeedToken?.value;
  const flags = unique([...patternMatch.flags, ...extractFlags(clean)]);
  // Compare compact tokens, preserving anything the parser does not understand.
  const remainder = removeToken(rest, loadSpeedToken?.raw)
    .replace(/\s+/g, '')
    .replace(/EVT|EV|SP|XL|PRO|白字|白|增强型|低滚阻|左|右/g, '')
    .replace(/[()（）\[\]，,;；:：-]/g, '');

  return {
    brand: brand ? canonicalBrand(brand) : embeddedBrand
      ?? (/^MK/.test(patternMatch.pattern) ? '迈劲' : /^(?:TF|RD-)/.test(patternMatch.pattern) ? '天府' : BRAND),
    pattern: patternMatch.pattern,
    size,
    ply,
    loadSpeed,
    flags,
    raw: normalized,
    ...(issues.length ? { issues } : {}),
    ...(remainder ? { unrecognized: remainder } : {}),
  };
}

function parseProduct(product: Product): ParsedTire | null {
  let parsed: ParsedTire;
  try {
    parsed = parseInbound(product.spec, product.brand || BRAND);
  } catch {
    return null;
  }
  const issues: string[] = [...(parsed.issues ?? [])];
  if (/^MK\d/.test(parsed.pattern) && normalizeBrand(product.brand) !== '迈劲') {
    issues.push(`MK 花纹属于迈劲，请核对商品目录品牌 ${product.brand}`);
  }
  const codePattern = parsePatternFromCode(product.code)?.pattern ?? extractSupplierPattern(product.code)?.pattern;
  const codeSize = extractSize(product.code);
  const codePly = extractPly(product.code);
  // A shortened SKU pattern (HD302 vs HD302EVT) adds no information.
  if (codePattern && parsed.pattern !== codePattern
    && !['EV', 'EVT', 'SP'].some(suffix => parsed.pattern === `${codePattern}${suffix}`)) {
    issues.push(`SKU 花纹 ${codePattern} 与商品规格花纹 ${parsed.pattern} 冲突`);
  }
  if (codeSize && codeSize !== parsed.size) {
    issues.push(`SKU 尺寸 ${codeSize} 与商品规格尺寸 ${parsed.size} 冲突`);
  }
  if (codePly && parsed.ply && codePly !== parsed.ply) {
    issues.push(`SKU 层级 ${codePly} 与商品规格层级 ${parsed.ply} 冲突`);
  }
  return { ...parsed, ...(issues.length ? { issues } : {}) };
}

export const haidaAdapter: BrandAdapter = {
  id: 'haida',
  label: BRAND,
  supplierName: '四川海大轮胎橡胶集团股份有限公司',
  version: ADAPTER_VERSION,
  brandAliases: ['海大', 'HAIDA', '天府', 'TIANFU', '迈劲', 'MILEKING'],
  // Owner confirmed these exact model associations on 2026-10-19.
  confirmedMappings: [
    {
      model: 'HAIDA 185R14C 8PR 102/100R EV HD501',
      code: 'HD501-185R14C',
      spec: '185R14C 8PR 102/100R HD501',
      brand: '海大', unit: '条',
    },
    {
      model: 'HAIDA 255/45ZR20 105W XL HD937',
      code: 'HD937-H255/45ZR20XL',
      spec: 'H255/45ZR20XL 105W HD937EV',
      brand: '海大', unit: '条',
    },
  ],
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
