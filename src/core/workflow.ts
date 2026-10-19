import type { BrandIndex } from './matcher';
import type { MatchResult, RawInboundRow } from './types';
import { validateInboundRow } from './excel';

// The same final decision feeds the table, report and export.
export function resolveResult(result: MatchResult, row: RawInboundRow | undefined, index: BrandIndex,
  manualCode?: string, confirmed = false, disposition?: 'new' | 'skip'): MatchResult {
  const update = (status: MatchResult['status'], method: MatchResult['method'], reason: string,
    product = result.product, candidates = result.candidates): MatchResult => ({
    ...result, status, method, reason, warning: undefined, product, candidates,
    trace: { ...result.trace, result: status, method, reason, warning: undefined,
      matchedCode: status === 'matched' ? product?.code : undefined,
      candidates: candidates.map(c => ({ code: c.product.code, spec: c.product.spec, score: c.score, reason: c.reason })) },
  });
  const errors = row ? validateInboundRow(row) : ['订单行已失效，请重新匹配'];
  if (disposition) return { ...update('unmatched', 'none', (disposition === 'new'
    ? '已标记待新建商品：本行不写入入库模板。请回业务系统新建商品，更新目录后重新匹配。'
    : '已明确选择本次跳过：本行不写入入库模板。') + (errors.length ? ` 原始数据异常：${errors.join('；')}` : ''), undefined, []), product: undefined };
  if (errors.length) return { ...update('review', 'none', `数据异常：${errors.join('；')}。请修正原表后重新上传，或明确本次跳过。`, undefined, []), product: undefined };
  if (manualCode) {
    const product = index.byCode.get(manualCode);
    if (product) return update('matched', 'manual', '人工选择', product);
  }
  if (result.method === 'core' && result.product) return update(confirmed ? 'matched' : 'review', 'core',
    confirmed ? '已人工确认' : `${(result.reason ?? result.warning ?? '请核对商品描述').replace(/，请核对$/, '')}；确认后导出`);
  return result;
}

export function pendingRows(results: MatchResult[], newProducts: Record<number, boolean>, skipped: Record<number, boolean>): number {
  return results.filter(r => r.status !== 'matched' && !newProducts[r.trace.rowNumber] && !skipped[r.trace.rowNumber]).length;
}
