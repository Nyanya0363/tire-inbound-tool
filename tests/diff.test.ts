import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { diffTire } from '../src/core/diff';

function parseInbound(model: string) {
  return haidaAdapter.parseInbound(model);
}

function parseProduct(code: string, spec: string) {
  const parsed = haidaAdapter.parseProduct({
    code,
    spec,
    name: '轮胎（海大）',
    brand: '海大',
    unit: '条',
  });
  if (!parsed) throw new Error('parse failed');
  return parsed;
}

describe('tire diff', () => {
  it('flags a missing XL descriptor as batch-confirmable', () => {
    const diff = diffTire(
      parseInbound('HAIDA 235/50ZR20 104W XL HD937'),
      parseProduct('HD937-H235/50ZR20', 'H235/50ZR20 104W HD937'),
    );
    expect(diff.hasCritical).toBe(false);
    expect(diff.safeToBatchConfirm).toBe(true);
    expect(diff.summary).toContain('商品资料缺少XL');
  });

  it('flags a missing load speed as batch-confirmable', () => {
    const diff = diffTire(
      parseInbound('HAIDA LT255/60R19 8PR白字 113/110Q HD877'),
      parseProduct('HD877-LT255/60R19', 'LT255/60R19 8PR 113 HD877白字'),
    );
    expect(diff.hasCritical).toBe(false);
    expect(diff.safeToBatchConfirm).toBe(true);
    expect(diff.summary).toContain('载重速度');
  });

  it('treats a PRO variant as a critical difference', () => {
    const diff = diffTire(
      parseInbound('HAIDA LT275/65R20 10PR白字 HD877 Pro'),
      parseProduct('HD877-LT275/65R20', 'LT275/65R20 10PR白字 HD877'),
    );
    expect(diff.hasCritical).toBe(true);
    expect(diff.safeToBatchConfirm).toBe(false);
    expect(diff.summary).toContain('商品资料缺少Pro');
  });

  it('treats a different ply/load speed as critical', () => {
    const diff = diffTire(
      parseInbound('HAIDA 175R14LT 6PR 94/92R HD517'),
      parseProduct('HD517-175R14LT', '175R14LT8PRHD517 99/97R'),
    );
    expect(diff.hasCritical).toBe(true);
    expect(diff.safeToBatchConfirm).toBe(false);
  });
});
