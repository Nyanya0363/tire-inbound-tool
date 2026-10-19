import type { BrandAdapter } from '../brands/types';
import type { ParsedTire, Product } from './types';
import { makeExactKey, normalizeBrand, normalizeText } from './text';

export interface ConfirmedAlias {
  code: string;
  spec: string;
  brand: string;
  unit: string;
  sourceKey?: string;
}
export type AliasMap = Record<string, string | ConfirmedAlias>;

export function aliasCode(value: string | ConfirmedAlias): string {
  return typeof value === 'string' ? value : value.code;
}

export function aliasIsCurrent(value: ConfirmedAlias, product?: Product): boolean {
  return !!product && normalizeText(value.spec) === normalizeText(product.spec)
    && normalizeBrand(value.brand) === normalizeBrand(product.brand)
    && value.unit === product.unit;
}

export function rememberAlias(model: string, product: Product, adapter: BrandAdapter, brand?: string): ConfirmedAlias {
  let sourceKey: string | undefined;
  try { sourceKey = makeExactKey(adapter.parseInbound(model, brand)); } catch { /* Exact raw text can still be confirmed. */ }
  return { code: product.code, spec: product.spec, brand: product.brand, unit: product.unit, sourceKey };
}

export function readAliases(source: unknown): AliasMap {
  const result: AliasMap = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  for (const [key, value] of Object.entries(source)) {
    if (!key.trim()) continue;
    if (typeof value === 'string' && value.trim()) result[normalizeText(key)] = value.trim();
    else if (value && typeof value === 'object' && ['code', 'spec', 'brand', 'unit'].every(
      field => typeof (value as Record<string, unknown>)[field] === 'string',
    )) {
      const entry = value as ConfirmedAlias;
      if (entry.code.trim() && entry.spec.trim()) result[normalizeText(key)] = {
        code: entry.code, spec: entry.spec, brand: entry.brand, unit: entry.unit,
        ...(typeof entry.sourceKey === 'string' ? { sourceKey: entry.sourceKey } : {}),
      };
    }
  }
  return result;
}

export function findAlias(model: string, parsed: ParsedTire | null, aliases: AliasMap) {
  const exact = aliases[normalizeText(model)];
  if (exact) return [exact];
  const key = parsed ? makeExactKey(parsed) : undefined;
  return key ? Object.values(aliases).filter(value => typeof value !== 'string' && value.sourceKey === key) : [];
}

export function forgetAlias(model: string, parsed: ParsedTire | null, aliases: AliasMap): AliasMap {
  const rawKey = normalizeText(model);
  const sourceKey = parsed ? makeExactKey(parsed) : undefined;
  return Object.fromEntries(Object.entries(aliases).filter(([key, value]) =>
    normalizeText(key) !== rawKey && !(sourceKey && typeof value !== 'string' && value.sourceKey === sourceKey)));
}
