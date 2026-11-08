import type { BrandAdapter } from '../brands/types';
import type { ParsedTire, Product, Candidate } from './types';
import type { BrandIndex } from './matcher';
import { diffTire } from './diff';
import { makeExactKey, normalizeBrand, normalizeText, samePatternFamily } from './text';
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
  let source: ParsedTire;
  try { source = adapter.parseInbound(model, brand || undefined); } catch { return entry; }
  const target = index.parsedProducts.get(product.code);
  if (target && candidateOrigin(source, target, model, brand, adapter)) entry.confirmation = {
    sourceBrand: normalizeBrand(brand), embeddedBrand: embeddedBrand(model), sourceKey: makeExactKey(source),
    differences: confirmationSignature(source, target), rawModel: normalizeText(model), sourceSnapshot: { ...source, flags: [...source.flags] },
  };
  return entry;
}

// This validator is also the source of the user-visible invalidation explanation.
export function validateReviewedMemory(entry: string | ConfirmedAlias, model: string, brand: string, source: ParsedTire | null, index: BrandIndex, adapter: BrandAdapter) {
  const sku = typeof entry === 'string' ? entry : entry.code;
  const reasons: import('./types').MemoryInvalidation[] = [];
  const add = (code: string, message: string, field?: string, before?: string, after?: string) => reasons.push({code,sku,field,before,after,message});
  const changed = (field: string, label: string, before: string, after: string) => {
    if (before !== after) add('field_changed', `${label}变化：${before || '未提供'} → ${after || '未提供'}`, field, before, after);
  };
  const product=index.byCode.get(sku), target=index.parsedProducts.get(sku);
  if (!product) add('target_missing', `原SKU ${sku} 已不在当前目录`);
  if (typeof entry === 'string') { add('snapshot_missing','旧记录只有SKU，没有商品快照，无法验证'); return {valid:false,reasons}; }
  if (product) {
    changed('spec','目录规格',normalizeText(entry.spec),normalizeText(product.spec));
    changed('brand','目录品牌',normalizeBrand(entry.brand),normalizeBrand(product.brand));
    changed('unit','目录单位',entry.unit,product.unit);
  }
  const saved=entry.confirmation;
  if (!saved && product) {
    if (brand && normalizeBrand(entry.brand) !== normalizeBrand(brand)) add('source_brand_conflict', '来源品牌列与旧对应商品品牌冲突：' + brand + ' / ' + entry.brand, 'brand', entry.brand, brand);
    if (source && (normalizeBrand(entry.brand) !== normalizeBrand(source.brand) || !samePatternFamily(source.pattern, target?.pattern ?? '')))
      add('source_pattern_conflict', '旧对应商品与当前型号的品牌或基础花纹不兼容：' + entry.brand + ' ' + (target?.pattern ?? '无法解析') + ' → ' + source.brand + ' ' + source.pattern);
  }
  if (saved) {
    changed('sourceBrand','来源品牌列',saved.sourceBrand,normalizeBrand(brand));
    changed('embeddedBrand','型号品牌',saved.embeddedBrand,embeddedBrand(model));
    changed('rawModel','来源原文',saved.rawModel,normalizeText(model));
    if (!source) add('parse_failed','当前厂家型号无法解析，不能验证已确认的字段');
    else {
      if (saved.sourceKey !== makeExactKey(source)) {
        const previous=saved.sourceSnapshot;
        if (previous) {
          for (const [field,label] of [['brand','来源品牌'],['pattern','来源花纹'],['size','来源尺寸'],['ply','来源层级'],['loadSpeed','来源载重速度'],['unrecognized','来源未识别内容']] as const)
            changed(field,label,previous[field] ?? '',source[field] ?? '');
          changed('flags','来源标识',[...previous.flags].sort().join(','),[...source.flags].sort().join(','));
        } else add('source_snapshot_missing','来源字段已变化；旧记录未保存结构化来源字段，无法列出历史字段值');
        add('source_key_changed','来源完整型号字段与确认时不一致');
      }
      if (!target) add('target_parse_failed','当前目录规格无法解析，不能验证已认可差异');
      else {
        if (saved.differences !== confirmationSignature(source,target)) add('differences_changed','已认可的差异范围发生变化，请结合当前逐项差异重新核对','differences',saved.differences,confirmationSignature(source,target));
        if (!candidateOrigin(source,target,model,brand,adapter)) add('scope_changed','当前商品不再符合当时确认的候选依据');
      }
    }
  }
  return {valid:reasons.length===0,reasons};
}
