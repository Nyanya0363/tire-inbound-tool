import type { BrandAdapter } from '../brands/types';
import type { Candidate, Catalog, MatchResult, MatchTrace, ParsedTire, Product } from './types';
import { diffTire } from './diff';
import { explainMatch } from './explanations';
import { aliasCode, aliasIsCurrent, findAlias, rememberAlias } from './aliases';
import type { AliasMap } from './aliases';
export type { AliasMap } from './aliases';
import {
  makeCoreFlagsKey,
  makeCoreKey,
  makeExactKey,
  makeSizePatternKey,
  normalizeBrand,
  normalizeText,
  samePatternFamily,
} from './text';

export interface BrandIndex {
  products: Product[];
  byCode: Map<string, Product>;
  exact: Map<string, Product[]>;
  core: Map<string, Product[]>;
  coreFlags: Map<string, Product[]>;
  sizePattern: Map<string, Product[]>;
  parsedProducts: Map<string, ParsedTire>;
  skipped: Array<{ code: string; reason: string }>;
}

function addToMap(map: Map<string, Product[]>, key: string, product: Product): void {
  const existing = map.get(key);
  if (existing) existing.push(product);
  else map.set(key, [product]);
}

export function buildBrandIndex(catalog: Catalog, adapter: BrandAdapter): BrandIndex {
  const aliases = new Set(adapter.brandAliases.map(normalizeBrand));
  const products = catalog.products.filter((product) => {
    const brand = normalizeBrand(product.brand);
    return aliases.has(brand);
  });

  const byCode = new Map<string, Product>();
  const exact = new Map<string, Product[]>();
  const core = new Map<string, Product[]>();
  const coreFlags = new Map<string, Product[]>();
  const sizePattern = new Map<string, Product[]>();
  const parsedProducts = new Map<string, ParsedTire>();
  const skipped: Array<{ code: string; reason: string }> = [];

  for (const product of products) {
    byCode.set(product.code, product);
    const parsed = adapter.parseProduct(product);
    if (!parsed) {
      skipped.push({ code: product.code, reason: '商品规格无法解析' });
      continue;
    }
    parsedProducts.set(product.code, parsed);
    addToMap(exact, makeExactKey(parsed), product);
    addToMap(core, makeCoreKey(parsed), product);
    addToMap(coreFlags, makeCoreFlagsKey(parsed), product);
    addToMap(sizePattern, makeSizePatternKey(parsed), product);
  }

  return {
    products,
    byCode,
    exact,
    core,
    coreFlags,
    sizePattern,
    parsedProducts,
    skipped,
  };
}

function candidateScore(parsed: ParsedTire, product: Product, index: BrandIndex): Candidate {
  const productParsed = index.parsedProducts.get(product.code);
  if (!productParsed) return { product, score: 0, reason: '商品规格无法完整解析，请维护商品资料' };
  const diff = diffTire(parsed, productParsed);
  const score = (parsed.size === productParsed.size ? 40 : 0)
    + (parsed.pattern === productParsed.pattern ? 30 : 0)
    + (parsed.ply === productParsed.ply ? 10 : 0)
    + (parsed.loadSpeed === productParsed.loadSpeed ? 10 : 0)
    + (parsed.flags.slice().sort().join() === productParsed.flags.slice().sort().join() ? 10 : 0);
  const same = diff.items.filter(item => !item.different && ['size', 'pattern', 'ply', 'loadSpeed'].includes(item.field))
    .map(item => `${item.label}一致（${item.manufacturer}）`);
  return { product, score, reason: [...same, ...diff.reasons,
    ...(productParsed.issues ?? []),
    ...(productParsed.unrecognized ? [`商品规格有未识别内容：${productParsed.unrecognized}`] : []),
  ].join('；') };
}

function rankCandidates(parsed: ParsedTire, products: Product[], index: BrandIndex): Candidate[] {
  return products
    .map((product) => candidateScore(parsed, product, index))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function makeTrace(
  rowNumber: number,
  rawModel: string,
  parsed: ParsedTire | null,
  result: Omit<MatchTrace, 'rowNumber' | 'rawModel' | 'parsed' | 'candidates'> & {
    candidates?: Candidate[];
  },
): MatchTrace {
  return {
    rowNumber,
    rawModel,
    parsed,
    exactKey: result.exactKey,
    coreKey: result.coreKey,
    sizePatternKey: result.sizePatternKey,
    exactCount: result.exactCount,
    coreCount: result.coreCount,
    result: result.result,
    method: result.method,
    matchedCode: result.matchedCode,
    warning: result.warning,
    reason: result.reason,
    candidates: (result.candidates ?? []).map((candidate) => ({
      code: candidate.product.code,
      spec: candidate.product.spec,
      score: candidate.score,
      reason: candidate.reason,
    })),
    error: result.error,
  };
}

function matchParsedRow(
  rowNumber: number,
  rawModel: string,
  adapter: BrandAdapter,
  index: BrandIndex,
  aliases: AliasMap,
  brand?: string,
): MatchResult {
  let parsed: ParsedTire | null = null;
  let exactKey = '';
  let coreKey = '';
  let coreFlagsKey = '';
  let sizePatternKey = '';
  let parseError = '';

  try {
    parsed = adapter.parseInbound(rawModel, brand);
    exactKey = makeExactKey(parsed);
    coreKey = makeCoreKey(parsed);
    coreFlagsKey = makeCoreFlagsKey(parsed);
    sizePatternKey = makeSizePatternKey(parsed);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const modelKey = normalizeText(rawModel);
  const entries = findAlias(rawModel, parsed, aliases).filter(entry => {
    const product = index.byCode.get(aliasCode(entry));
    return !product || normalizeBrand(product.brand) === normalizeBrand(brand || parsed?.brand || product.brand);
  });
  if (!entries.length) {
    for (const mapping of adapter.confirmedMappings ?? []) {
      const entry = rememberAlias(mapping.model, { ...mapping, name: '' }, adapter);
      if (normalizeText(mapping.model) === modelKey || (parsed && entry.sourceKey === makeExactKey(parsed))) entries.push(entry);
    }
  }
  const current = entries.filter(entry => typeof entry !== 'string'
    && aliasIsCurrent(entry, index.byCode.get(entry.code))
    && (!brand || normalizeBrand(entry.brand) === normalizeBrand(brand))
    && (!parsed || (normalizeBrand(entry.brand) === normalizeBrand(parsed.brand)
      && samePatternFamily(parsed.pattern, index.parsedProducts.get(entry.code)?.pattern ?? ''))));
  const currentCodes = new Set(current.map(aliasCode));
  if (currentCodes.size === 1 && current.length === entries.length) {
    const product = index.byCode.get([...currentCodes][0]);
    if (product) {
      const aliasReason = '命中已确认的型号对应关系，商品规格快照一致';
      const trace = makeTrace(rowNumber, rawModel, parsed, {
        exactKey,
        coreKey,
        sizePatternKey,
        exactCount: 0,
        coreCount: 0,
        result: 'matched',
        method: 'alias',
        matchedCode: product.code,
        reason: aliasReason,
      });
      return {
        status: 'matched',
        method: 'alias',
        product,
        candidates: [],
        reason: aliasReason,
        parsed,
        trace,
      };
    }
  }

  if (entries.length) {
    const reason = '已保存的对应关系缺少规格快照、商品已变更或存在冲突，请人工核对后重新选择并保存。';
    const products = [...new Set(entries.map(aliasCode))].map(code => index.byCode.get(code))
      .filter((product): product is Product => !!product
        && normalizeBrand(product.brand) === normalizeBrand(brand || parsed?.brand || product.brand)
        && (!parsed || samePatternFamily(parsed.pattern, index.parsedProducts.get(product.code)?.pattern ?? '')));
    const candidates = parsed ? rankCandidates(parsed, products, index) : products.map(product => ({ product, score: 0, reason }));
    return { status: 'review', method: 'candidate', parsed, candidates, reason,
      explanations: [{ code: 'memory_review', message: reason }],
      trace: makeTrace(rowNumber, rawModel, parsed, { exactKey, coreKey, sizePatternKey, exactCount: 0, coreCount: 0,
        result: 'review', method: 'candidate', reason, candidates }) };
  }
  if (!parsed) {
    const reason = `${parseError}。型号规则无法完整识别，请人工选择商品；确认后可保存对应关系。`;
    return { status: 'unmatched', method: 'none', parsed: null, candidates: [], reason,
      trace: makeTrace(rowNumber, rawModel, null, { exactKey, coreKey, sizePatternKey, exactCount: 0, coreCount: 0,
        result: 'unmatched', method: 'none', reason, error: parseError }) };
  }

  const exactProducts = index.exact.get(exactKey) ?? [];
  if (exactProducts.length === 1 && parsed.loadSpeed) {
    const product = exactProducts[0];
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 1,
      coreCount: index.core.get(coreKey)?.length ?? 0,
      result: 'matched',
      method: 'exact',
      matchedCode: product.code,
    });
    return {
      status: 'matched',
      method: 'exact',
      product,
      candidates: [],
      parsed,
      trace,
    };
  }

  if (exactProducts.length > 1 || (exactProducts.length === 1 && !parsed.loadSpeed)) {
    const candidates = rankCandidates(parsed, !parsed.loadSpeed
      ? index.sizePattern.get(sizePatternKey) ?? exactProducts : exactProducts, index);
    const reason = !parsed.loadSpeed ? '厂家型号未识别到完整载重速度，请人工核对，不能按缺失字段自动确认。'
      : '有多个商品编号完全匹配，需要人工确认';
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: exactProducts.length,
      coreCount: index.core.get(coreKey)?.length ?? 0,
      result: 'review',
      method: 'candidate',
      reason,
      candidates,
    });
    return {
      status: 'review',
      method: 'candidate',
      candidates,
      reason,
      parsed,
      trace,
    };
  }

  const coreProducts = index.core.get(coreKey) ?? [];
  if (coreProducts.length === 1 && !diffTire(parsed, index.parsedProducts.get(coreProducts[0].code)!).hasCritical) {
    const product = coreProducts[0];
    const warning = `${diffTire(parsed, index.parsedProducts.get(product.code)!).summary}，请核对`;
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: 1,
      result: 'review',
      method: 'core',
      warning,
      reason: warning,
    });
    return {
      status: 'review',
      method: 'core',
      product,
      candidates: [],
      warning,
      reason: warning,
      parsed,
      trace,
    };
  }

  if (coreProducts.length > 1) {
    // White-letter / left-right / Pro variants often share the same
    // pattern+size+ply. If flags narrow it down to one, we can match safely.
    const coreFlagProducts = index.coreFlags.get(coreFlagsKey) ?? [];
    if (coreFlagProducts.length === 1 && !diffTire(parsed, index.parsedProducts.get(coreFlagProducts[0].code)!).hasCritical) {
      const product = coreFlagProducts[0];
      const warning = `${diffTire(parsed, index.parsedProducts.get(product.code)!).summary}，请核对`;
      const trace = makeTrace(rowNumber, rawModel, parsed, {
        exactKey,
        coreKey,
        sizePatternKey,
        exactCount: 0,
        coreCount: coreProducts.length,
        result: 'review',
        method: 'core',
        warning,
        reason: warning,
      });
      return {
        status: 'review',
        method: 'core',
        product,
        candidates: [],
        warning,
        reason: warning,
        parsed,
        trace,
      };
    }

    const reviewProducts = coreFlagProducts.length > 1 ? coreFlagProducts : coreProducts;
    const candidates = rankCandidates(parsed, reviewProducts, index);
    const reason = '规格/花纹/层级有多个候选，需要人工确认';
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: coreProducts.length,
      result: 'review',
      method: 'candidate',
      reason,
      candidates,
    });
    return {
      status: 'review',
      method: 'candidate',
      candidates,
      reason,
      parsed,
      trace,
    };
  }

  const sameSizePattern = index.sizePattern.get(sizePatternKey) ?? [];
  if (sameSizePattern.length > 0) {
    const candidates = rankCandidates(parsed, sameSizePattern, index);
    const reason = '找到同花纹同规格商品，但层级或载重速度不一致，不能自动匹配';
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: 0,
      result: 'review',
      method: 'candidate',
      reason,
      candidates,
    });
    return {
      status: 'review',
      method: 'candidate',
      candidates,
      reason,
      parsed,
      trace,
    };
  }

  const missingProductReason = '未找到同品牌、同花纹、同规格商品，疑似未建档或型号写法不同。请人工核对；若确认是新品，请回业务系统新建商品，更新商品目录后重新匹配。';
  const sameBrand = index.products.filter(product =>
    normalizeBrand(index.parsedProducts.get(product.code)?.brand ?? product.brand) === normalizeBrand(parsed.brand));
  const sameSize = sameBrand.filter(product => index.parsedProducts.get(product.code)?.size === parsed.size);
  const nearPattern = sameSize.filter(product =>
    samePatternFamily(index.parsedProducts.get(product.code)!.pattern, parsed.pattern));
  if (nearPattern.length > 0) {
    const candidates = rankCandidates(parsed, nearPattern, index);
    const reason = '找到同品牌同规格、EV 后缀不同的候选商品，可能为同款升级。其他参数也需核对，确认前不自动对应。';
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: 0,
      result: 'review',
      method: 'candidate',
      reason,
      candidates,
    });
    return {
      status: 'review',
      method: 'candidate',
      candidates,
      reason,
      parsed,
      trace,
    };
  }

  const references = rankCandidates(parsed, sameBrand.filter(product =>
    index.parsedProducts.get(product.code)?.pattern === parsed.pattern), index);
  const reason = `${missingProductReason}${sameSize.length ? ' 同规格但基础花纹不同的商品已排除。' : ''}${references.length ? ' 以下仅为同花纹其他规格的辅助参考。' : ''}`;
  const trace = makeTrace(rowNumber, rawModel, parsed, {
    exactKey,
    coreKey,
    sizePatternKey,
    exactCount: 0,
    coreCount: 0,
    result: 'unmatched',
    method: 'none',
    reason,
    candidates: references,
  });
  return {
    status: 'unmatched',
    method: 'none',
    candidates: references,
    reason,
    parsed,
    trace,
  };
}

function matchCheckedRow(
  rowNumber: number, rawModel: string, adapter: BrandAdapter,
  index: BrandIndex, aliases: AliasMap, brand?: string,
): MatchResult {
  const result = matchParsedRow(rowNumber, rawModel, adapter, index, aliases, brand);
  if (!result.product) return result;
  const productParsed = index.parsedProducts.get(result.product.code);
  const problems = [...(result.parsed?.issues ?? []), ...(productParsed?.issues ?? [])];
  if (result.method !== 'alias') {
    if (result.parsed?.unrecognized) problems.push(`厂家型号有未识别内容：${result.parsed.unrecognized}`);
    if (productParsed?.unrecognized) problems.push(`商品规格有未识别内容：${productParsed.unrecognized}`);
  }
  if (!problems.length) return result;
  const reason = `${problems.join('；')}。请人工核对商品规格后重新选择。`;
  const comparison = result.parsed ?? productParsed;
  const candidates = comparison ? [candidateScore(comparison, result.product, index)]
    : [{ product: result.product, score: 0, reason }];
  return {
    ...result, status: 'review', method: 'candidate', product: undefined, reason, warning: undefined, candidates,
    trace: makeTrace(rowNumber, rawModel, result.parsed, {
      ...result.trace, result: 'review', method: 'candidate', matchedCode: undefined, warning: undefined, reason, candidates,
    }),
  };
}

export function matchRow(
  rowNumber: number, rawModel: string, adapter: BrandAdapter,
  index: BrandIndex, aliases: AliasMap, brand?: string,
): MatchResult {
  return explainMatch(matchCheckedRow(rowNumber, rawModel, adapter, index, aliases, brand), index.parsedProducts);
}

export function unsupportedBrandResult(
  rowNumber: number,
  rawModel: string,
  brand: string,
): MatchResult {
  const reason = `品牌“${brand || '未知'}”尚未配置匹配规则，已跳过`;
  const trace = makeTrace(rowNumber, rawModel, null, {
    exactKey: '',
    coreKey: '',
    sizePatternKey: '',
    exactCount: 0,
    coreCount: 0,
    result: 'unmatched',
    method: 'none',
    reason,
  });
  return {
    status: 'unmatched',
    method: 'none',
    candidates: [],
    reason,
    parsed: null,
    explanations: [{ code: 'unsupported_brand', message: reason }],
    trace: { ...trace, explanations: [{ code: 'unsupported_brand', message: reason }] },
  };
}

export function makeAliasKey(rawModel: string): string {
  return normalizeText(rawModel);
}
