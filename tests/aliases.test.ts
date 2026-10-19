import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, makeAliasKey, matchRow } from '../src/core/matcher';
import { readAliases, rememberAlias } from '../src/core/aliases';
import type { Product } from '../src/core/types';

const product: Product = { code: 'SKU1', spec: '165R14LT 8PR 96/95Q HD517', brand: '海大', name: '轮胎', unit: '条' };
const source = 'HAIDA 165R14LT 8PR 96/95Q HD517';
const memory = { [makeAliasKey(source)]: rememberAlias(source, product, haidaAdapter) };
function indexOf(products = [product]) {
  return buildBrandIndex({ version: 'test', generatedAt: '', products }, haidaAdapter);
}

describe('confirmed model memory', () => {
  it('reuses confirmed fields despite reordered tokens and spacing', () => {
    const result = matchRow(1, '海大 HD517 165 R14LT 8 PR 96/95 Q', haidaAdapter, indexOf(), memory);
    expect(result.method).toBe('alias');
    expect(result.product?.code).toBe(product.code);
  });

  it.each([
    { ...product, spec: '175R14LT 8PR 99/97R HD517' },
    { ...product, unit: '件' },
    { ...product, brand: '天府' },
  ])('does not reuse a changed target: %j', changed => {
    const result = matchRow(1, source, haidaAdapter, indexOf([changed]), memory);
    expect(result.status).not.toBe('matched');
    expect(result.product).toBeUndefined();
  });

  it('marks deleted targets and legacy code-only memories for reconfirmation', () => {
    expect(matchRow(1, source, haidaAdapter, indexOf([]), memory).reason).toContain('重新选择');
    const legacy = matchRow(1, source, haidaAdapter, indexOf(), { [makeAliasKey(source)]: product.code });
    expect(legacy.status).toBe('review');
    expect(legacy.product).toBeUndefined();
  });

  it('can replay an exact manually confirmed model the parser cannot recognize', () => {
    const raw = '厂家特殊型号甲';
    const aliases = { [makeAliasKey(raw)]: rememberAlias(raw, product, haidaAdapter) };
    const result = matchRow(1, raw, haidaAdapter, indexOf(), aliases, '海大');
    expect(result.status).toBe('matched');
    expect(result.method).toBe('alias');
    expect(result.product?.code).toBe(product.code);
  });

  it('requires review when equivalent source memories point to different products', () => {
    const other = { ...product, code: 'SKU2' };
    const aliases = { ...memory, second: rememberAlias(source, other, haidaAdapter) };
    const result = matchRow(1, 'HD517 165R14LT 8PR 96/95Q', haidaAdapter, indexOf([product, other]), aliases);
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
  });

  it('preserves specification snapshots through JSON export/import', () => {
    const restored = readAliases(JSON.parse(JSON.stringify(memory)));
    expect(restored).toEqual(memory);
    expect(matchRow(1, source, haidaAdapter, indexOf(), restored).method).toBe('alias');
    expect(readAliases({ bad: { code: 'SKU1' }, old: 'SKU1' })).toEqual({ OLD: 'SKU1' });
  });
});
