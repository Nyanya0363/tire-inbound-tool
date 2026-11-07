import type { BrandAdapter } from '../brands/types';
import type { ParsedTire, Product, Candidate } from './types';
import type { BrandIndex } from './matcher';
import { diffTire } from './diff';
import { makeExactKey, normalizeBrand, normalizeText } from './text';
import { rememberAlias } from './aliases';
import type { ConfirmedAlias } from './aliases';

export function embeddedBrand(model: string): string {
  const text = normalizeText(model);
  const found = [/\bHAIDA\b|海大/.test(text) ? '海大' : '', /\bTIANFU\b|天府/.test(text) ? '天府' : '', /\bMILEKING\b|迈劲/.test(text) ? '迈劲' : ''].filter(Boolean);
  return found.length === 1 ? found[0] : '';
}
const patternBase = (pattern: string) => pattern.replace(/(?:EVT|EV|SP)$/, '');
export function candidateOrigin(source: ParsedTire, target: ParsedTire, model: string, brand: string, adapter: BrandAdapter): Candidate['origin'] {
  if (adapter.id !== 'haida' || source.size !== target.size) return undefined;
  const supported = adapter.brandAliases.map(normalizeBrand);
  const column = normalizeBrand(brand), embedded = embeddedBrand(model);
  if (embedded && column && embedded !== column && supported.includes(column) && supported.includes(embedded)
    && [column, embedded].includes(normalizeBrand(target.brand)) && source.pattern === target.pattern) return 'brand_conflict';
  if (normalizeBrand(source.brand) === normalizeBrand(target.brand) && source.pattern !== target.pattern
    && patternBase(source.pattern) === patternBase(target.pattern)) return 'pattern_suffix';
  return undefined;
}
export function confirmationSignature(source: ParsedTire, target: ParsedTire): string {
  return JSON.stringify({ differences: diffTire(source, target).items.filter(item => item.different),
    sourceIssues: source.issues ?? [], targetIssues: target.issues ?? [], sourceUnknown: source.unrecognized ?? '', targetUnknown: target.unrecognized ?? '' });
}
export function rememberReviewedAlias(model: string, product: Product, adapter: BrandAdapter, brand: string, index: BrandIndex): ConfirmedAlias {
  const entry = rememberAlias(model, product, adapter, brand || undefined);
  const source = adapter.parseInbound(model, brand || undefined), target = index.parsedProducts.get(product.code);
  if (target && candidateOrigin(source, target, model, brand, adapter)) entry.confirmation = {
    sourceBrand: normalizeBrand(brand), embeddedBrand: embeddedBrand(model), sourceKey: makeExactKey(source),
    differences: confirmationSignature(source, target), rawModel: normalizeText(model),
  };
  return entry;
}
