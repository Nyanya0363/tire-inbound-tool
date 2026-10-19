import type { ParsedTire } from './types';

export type DiffSeverity = 'critical' | 'descriptor';

export interface DiffItem {
  field: string;
  label: string;
  manufacturer: string;
  product: string;
  different: boolean;
  severity: DiffSeverity;
}

export interface TireDiff {
  items: DiffItem[];
  reasons: string[];
  summary: string;
  hasCritical: boolean;
  safeToBatchConfirm: boolean;
  batchGroup?: string;
  batchLabel?: string;
}

const FLAG_LABELS: Record<string, string> = {
  XL: 'XL',
  WHITE: '白字',
  PRO: 'Pro',
  ENHANCED: '增强型',
  LOW_ROLL: '低滚阻',
  LEFT: '左',
  RIGHT: '右',
};

function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}

function addItem(
  items: DiffItem[],
  field: string,
  label: string,
  manufacturer?: string,
  product?: string,
  severity: DiffSeverity = 'critical',
): void {
  const left = manufacturer ?? '无';
  const right = product ?? '无';
  const different = left !== right;
  items.push({ field, label, manufacturer: left, product: right, different, severity });
}

export function diffTire(manufacturer: ParsedTire, product: ParsedTire): TireDiff {
  const items: DiffItem[] = [];
  const reasons: string[] = [];

  addItem(items, 'brand', '品牌', manufacturer.brand, product.brand, 'critical');

  addItem(items, 'pattern', '花纹', manufacturer.pattern, product.pattern, 'critical');
  addItem(items, 'size', '规格', manufacturer.size, product.size, 'critical');
  addItem(items, 'ply', '层级', manufacturer.ply, product.ply, 'critical');
  addItem(
    items,
    'loadSpeed',
    '载重速度',
    manufacturer.loadSpeed,
    product.loadSpeed,
    manufacturer.loadSpeed && product.loadSpeed ? 'critical' : 'descriptor',
  );

  const manufacturerFlags = new Set(manufacturer.flags);
  const productFlags = new Set(product.flags);
  const allFlags = [...new Set([...manufacturer.flags, ...product.flags])].sort();

  allFlags.forEach((flag) => {
    const left = manufacturerFlags.has(flag) ? flagLabel(flag) : '无';
    const right = productFlags.has(flag) ? flagLabel(flag) : '无';
    if (left === right) return;
    addItem(items, `flag:${flag}`, `标识 ${flagLabel(flag)}`, left, right,
      ['WHITE', 'LEFT', 'RIGHT'].includes(flag) ? 'critical' : 'descriptor');
    if (manufacturerFlags.has(flag) && !productFlags.has(flag)) {
      reasons.push(`商品资料缺少${flagLabel(flag)}`);
    } else if (!manufacturerFlags.has(flag) && productFlags.has(flag)) {
      reasons.push(`商品资料多出${flagLabel(flag)}`);
    }
  });

  items.forEach((item) => {
    if (!item.different || item.field.startsWith('flag:')) return;
    if (item.field === 'loadSpeed' && item.product === '无') {
      reasons.push('商品资料缺少载重速度');
      return;
    }
    if (item.field === 'loadSpeed' && item.manufacturer === '无') {
      reasons.push('商品资料多出载重速度');
      return;
    }
    const label = item.label;
    reasons.push(`${label}不一致：${item.manufacturer} → ${item.product}`);
  });

  const uniqueReasons = [...new Set(reasons)];
  const critical = items.some((item) => item.different && item.severity === 'critical');
  const descriptorOnly = !critical && uniqueReasons.length > 0;
  const batchKey = descriptorOnly ? [...uniqueReasons].sort().join('|') : undefined;
  const missingLabels = uniqueReasons
    .filter((reason) => reason.startsWith('商品资料缺少'))
    .map((reason) => reason.replace('商品资料缺少', ''));
  const extraLabels = uniqueReasons
    .filter((reason) => reason.startsWith('商品资料多出'))
    .map((reason) => reason.replace('商品资料多出', ''));
  const batchLabelParts: string[] = [];
  if (missingLabels.length) batchLabelParts.push(`缺少 ${missingLabels.join('、')}`);
  if (extraLabels.length) batchLabelParts.push(`多出 ${extraLabels.join('、')}`);

  return {
    items,
    reasons: uniqueReasons,
    summary: uniqueReasons.length ? uniqueReasons.join('；') : '完全一致',
    hasCritical: critical,
    safeToBatchConfirm: descriptorOnly,
    batchGroup: batchKey,
    batchLabel: descriptorOnly ? batchLabelParts.join('；') : undefined,
  };
}
