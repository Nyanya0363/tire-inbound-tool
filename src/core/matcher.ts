import Fuse from 'fuse.js';
import type { BrandAdapter } from '../brands/types';
import type { Candidate, Catalog, MatchResult, MatchTrace, ParsedTire, Product } from './types';
import {
  makeCoreFlagsKey,
  makeCoreKey,
  makeExactKey,
  makeSizePatternKey,
  normalizeBrand,
  normalizeText,
} from './text';

export interface BrandIndex {
  products: Product[];
  byCode: Map<string, Product>;
  exact: Map<string, Product[]>;
  core: Map<string, Product[]>;
  coreFlags: Map<string, Product[]>;
  sizePattern: Map<string, Product[]>;
  fuse: Fuse<Product>;
  parsedProducts: Map<string, ParsedTire>;
  skipped: Array<{ code: string; reason: string }>;
}

export interface AliasMap {
  [normalizedModel: string]: string;
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
    fuse: new Fuse(products, {
      keys: [
        { name: 'code', weight: 0.45 },
        { name: 'spec', weight: 0.4 },
        { name: 'name', weight: 0.15 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    }),
  };
}

function candidateScore(parsed: ParsedTire, product: Product, index: BrandIndex): Candidate {
  const productParsed = index.parsedProducts.get(product.code);
  let score = 50;
  const reasons: string[] = ['同花纹同规格'];

  if (productParsed) {
    if (parsed.ply && productParsed.ply && parsed.ply === productParsed.ply) {
      score += 20;
      reasons.push(`层级 ${parsed.ply}`);
    }
    if (parsed.loadSpeed && productParsed.loadSpeed && parsed.loadSpeed === productParsed.loadSpeed) {
      score += 20;
      reasons.push(`载重速度 ${parsed.loadSpeed}`);
    }
    if (parsed.flags.length > 0) {
      const productFlags = new Set(productParsed.flags);
      const shared = parsed.flags.filter((flag) => productFlags.has(flag));
      if (shared.length === parsed.flags.length) {
        score += 10;
        reasons.push(`标识 ${shared.join('/')}`);
      }
    }
  }

  return { product, score, reason: reasons.join('，') };
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

export function matchRow(
  rowNumber: number,
  rawModel: string,
  adapter: BrandAdapter,
  index: BrandIndex,
  aliases: AliasMap,
): MatchResult {
  let parsed: ParsedTire | null = null;
  let exactKey = '';
  let coreKey = '';
  let coreFlagsKey = '';
  let sizePatternKey = '';

  try {
    parsed = adapter.parseInbound(rawModel);
    exactKey = makeExactKey(parsed);
    coreKey = makeCoreKey(parsed);
    coreFlagsKey = makeCoreFlagsKey(parsed);
    sizePatternKey = makeSizePatternKey(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const trace = makeTrace(rowNumber, rawModel, null, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: 0,
      result: 'unmatched',
      method: 'none',
      reason: message,
      error: message,
    });
    return {
      status: 'unmatched',
      method: 'none',
      candidates: [],
      reason: message,
      parsed: null,
      trace,
    };
  }

  const aliasCode = aliases[normalizeText(rawModel)];
  if (aliasCode) {
    const product = index.byCode.get(aliasCode);
    if (product) {
      const trace = makeTrace(rowNumber, rawModel, parsed, {
        exactKey,
        coreKey,
        sizePatternKey,
        exactCount: 0,
        coreCount: 0,
        result: 'matched',
        method: 'alias',
        matchedCode: product.code,
        reason: '命中已保存的人工映射',
      });
      return {
        status: 'matched',
        method: 'alias',
        product,
        candidates: [],
        reason: '命中已保存的人工映射',
        parsed,
        trace,
      };
    }
  }

  const exactProducts = index.exact.get(exactKey) ?? [];
  if (exactProducts.length === 1) {
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

  if (exactProducts.length > 1) {
    const candidates = rankCandidates(parsed, exactProducts, index);
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: exactProducts.length,
      coreCount: index.core.get(coreKey)?.length ?? 0,
      result: 'review',
      method: 'candidate',
      reason: '有多个商品编号完全匹配，需要人工确认',
      candidates,
    });
    return {
      status: 'review',
      method: 'candidate',
      candidates,
      reason: '有多个商品编号完全匹配，需要人工确认',
      parsed,
      trace,
    };
  }

  const coreProducts = index.core.get(coreKey) ?? [];
  if (coreProducts.length === 1) {
    const product = coreProducts[0];
    const warning = '按规格/花纹/层级匹配，商品资料描述与厂家型号不完全一致，请核对';
    const trace = makeTrace(rowNumber, rawModel, parsed, {
      exactKey,
      coreKey,
      sizePatternKey,
      exactCount: 0,
      coreCount: 1,
      result: 'matched',
      method: 'core',
      matchedCode: product.code,
      warning,
      reason: warning,
    });
    return {
      status: 'matched',
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
    if (coreFlagProducts.length === 1) {
      const product = coreFlagProducts[0];
      const warning = '商品资料缺少部分载重速度描述，按花纹/规格/层级/标识匹配，请核对';
      const trace = makeTrace(rowNumber, rawModel, parsed, {
        exactKey,
        coreKey,
        sizePatternKey,
        exactCount: 0,
        coreCount: coreProducts.length,
        result: 'matched',
        method: 'core',
        matchedCode: product.code,
        warning,
        reason: warning,
      });
      return {
        status: 'matched',
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

  const fuzzy = index.fuse.search(`${parsed.pattern} ${parsed.size} ${rawModel}`, { limit: 5 });
  if (fuzzy.length > 0) {
    const candidates: Candidate[] = fuzzy.map((hit) => ({
      product: hit.item,
      score: Math.round((1 - (hit.score ?? 1)) * 100),
      reason: '品牌内模糊匹配候选',
    }));
    const reason = '自动匹配未命中，以下为品牌内模糊候选，请人工确认';
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

  const reason = '商品资料中没有找到候选商品';
  const trace = makeTrace(rowNumber, rawModel, parsed, {
    exactKey,
    coreKey,
    sizePatternKey,
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
    parsed,
    trace,
  };
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
    trace,
  };
}

export function makeAliasKey(rawModel: string): string {
  return normalizeText(rawModel);
}
