import { diffTire } from './diff';
import { samePatternFamily } from './text';
import type { ExplanationCode, MatchExplanation, MatchResult, ParsedTire } from './types';

export const EXPLANATION_LABELS: Record<ExplanationCode, string> = {
  ev_difference: 'EV 差异', parameter_difference: '参数不同', field_missing: '字段未提供',
  unrecognized: '内容未识别', data_conflict: '资料冲突', multiple_matches: '多个候选',
  not_found: '未找到对应商品', parse_error: '型号未完整识别', numeric_error: '数量或价格异常',
  memory_review: '对应关系需复核', unsupported_brand: '品牌未配置',
};

const PRIORITY: Record<ExplanationCode, number> = {
  numeric_error: 0, unsupported_brand: 1, data_conflict: 2, parse_error: 3, unrecognized: 4,
  parameter_difference: 5, multiple_matches: 6, ev_difference: 7, field_missing: 8,
  memory_review: 9, not_found: 10,
};

export function uniqueExplanations(items: MatchExplanation[]): MatchExplanation[] {
  return [...new Map(items.map(item => [JSON.stringify(item), item])).values()]
    .sort((a, b) => PRIORITY[a.code] - PRIORITY[b.code]);
}

export function formatExplanations(items?: MatchExplanation[]): string {
  return (items ?? []).map(item => `${EXPLANATION_LABELS[item.code]}：${item.message}`).join('；');
}

function sourceExplanations(parsed: ParsedTire | null | undefined, side: 'manufacturer' | 'product'): MatchExplanation[] {
  if (!parsed) return [];
  const label = side === 'manufacturer' ? '厂家' : '目录';
  return [
    ...(parsed.issues ?? []).map(message => ({ code: 'data_conflict' as const, side, message: `${label}：${message}` })),
    ...(parsed.unrecognized ? [{ code: 'unrecognized' as const, side, message: `${label}尚未识别的原文：${parsed.unrecognized}。请结合原规格核对。` }] : []),
  ];
}

export function comparisonExplanations(source: ParsedTire | null | undefined, target: ParsedTire | null | undefined): MatchExplanation[] {
  const items = [...sourceExplanations(source, 'manufacturer'), ...sourceExplanations(target, 'product')];
  if (!source || !target) {
    items.push({ code: 'parse_error', message: `${!source ? '厂家型号' : '目录规格'}无法完整解析，系统无法验证全部字段，请对照原文人工核对。` });
    return uniqueExplanations(items);
  }
  for (const item of diffTire(source, target).items) {
    if (!item.different) continue;
    const left = item.manufacturer === '无' ? '未提供' : item.manufacturer;
    const right = item.product === '无' ? '未提供' : item.product;
    if (item.field === 'pattern' && samePatternFamily(source.pattern, target.pattern)) {
      items.push({ code: 'ev_difference', field: item.field,
        message: `厂家 ${source.pattern}，目录 ${target.pattern}；可能是同款 EV 升级，需人工核对。` });
    } else if (!item.field.startsWith('flag:') && (left === '未提供' || right === '未提供')) {
      const side = left === '未提供' ? 'manufacturer' : 'product';
      const parsed = side === 'manufacturer' ? source : target;
      const label = side === 'manufacturer' ? '厂家' : '目录';
      // A missing parsed field may still exist in the unrecognized raw text.
      items.push({ code: parsed.unrecognized ? 'unrecognized' : 'field_missing', field: item.field, side,
        message: parsed.unrecognized
          ? `${label}${item.label}未完整识别；已识别值：厂家 ${left}，目录 ${right}。请结合未识别原文核对。`
          : `${item.label}：厂家 ${left}，目录 ${right}。${label}未提供可识别的完整字段，请核对原规格。` });
    } else {
      items.push({ code: item.severity === 'critical' ? 'parameter_difference' : 'field_missing', field: item.field,
        message: `${item.label}：厂家 ${left}，目录 ${right}。请人工核对是否同一商品。` });
    }
  }
  return uniqueExplanations(items);
}

// Presentation metadata only: never changes status, product, ranking or export eligibility.
export function explainMatch(result: MatchResult, products: Map<string, ParsedTire>): MatchResult {
  const candidates = result.candidates.map(candidate => ({ ...candidate,
    explanations: comparisonExplanations(result.parsed, products.get(candidate.product.code)) }));
  const items: MatchExplanation[] = [...(result.explanations ?? []), ...sourceExplanations(result.parsed, 'manufacturer')];
  if (result.product) items.push(...comparisonExplanations(result.parsed, products.get(result.product.code)));
  else if (result.status === 'review' && candidates.length === 1) items.push(...candidates[0].explanations);
  else if (result.status === 'review' && candidates.length > 1) {
    items.push({ code: 'multiple_matches', message: result.trace.exactCount > 1
      ? `有 ${result.trace.exactCount} 个商品编号的已识别规格字段一致，不能按 SKU 自动选一个。请逐个核对后选择。`
      : '有多个候选商品，各自差异见下方；请先查看差异，再选择商品。' });
    const common = candidates[0].explanations.filter(item => candidates.every(c =>
      c.explanations.some(other => JSON.stringify(item) === JSON.stringify(other))));
    items.push(...common);
  }
  if (result.trace.error) items.push({ code: 'parse_error', message: '厂家型号未完整识别；请对照原文选择商品，不能据此判定为新品。' });
  else if (result.status === 'unmatched' && result.parsed) items.push({ code: 'not_found',
    message: `当前目录未找到同品牌 ${result.parsed.brand}、同花纹 ${result.parsed.pattern}、同规格 ${result.parsed.size} 的对应商品。请核实资料是否最新；确认未建档后再标记待新建。${candidates.length ? '下方是同花纹其他规格的辅助参考。' : ''}` });
  if (result.status === 'review' && result.parsed && !result.parsed.loadSpeed
    && !items.some(item => item.field === 'loadSpeed')) items.push({
      code: result.parsed.unrecognized ? 'unrecognized' : 'field_missing', field: 'loadSpeed', side: 'manufacturer',
      message: result.parsed.unrecognized ? '厂家载重速度未完整识别，请结合未识别原文核对。' : '厂家未提供可识别的完整载重速度，请核对原规格。',
    });
  const explanations = uniqueExplanations(items);
  return { ...result, candidates, explanations,
    trace: { ...result.trace, explanations, candidates: candidates.map(candidate => ({
      code: candidate.product.code, spec: candidate.product.spec, score: candidate.score,
      reason: candidate.reason, explanations: candidate.explanations,
    })) } };
}
