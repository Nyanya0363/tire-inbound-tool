import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterPickerProducts, ProductPicker } from '../src/components/ProductPicker';
import type { Product } from '../src/core/types';

const products: Product[] = ['海大', '天府', '迈劲', ''].map((brand, i) => ({
  code: `SKU${i}`, spec: '185R14C 8PR 102/100R', name: '轮胎', brand, unit: '条',
}));

describe('product picker brand and layout content', () => {
  it.each([['海大', 'SKU0'], ['TIANFU', 'SKU1'], ['迈劲 185R14C', 'SKU2'], ['MILEKING 185R14C', 'SKU2']])(
    'searches brand and specification together: %s', (query, code) => {
      expect(filterPickerProducts(products, query).map(p => p.code)).toEqual([code]);
    });
  it('shows actual catalog brands, missing-brand label, source model and SKU', () => {
    const html = renderToStaticMarkup(<ProductPicker open products={products} selectedCode="SKU1"
      sourceBrand="天府" sourceModel="TIANFU 185R14C 8PR 102/100R" onSelect={() => { throw Error('Rendering must not select'); }} onClose={() => {}} />);
    for (const label of ['海大', '天府', '迈劲', '未标注品牌', '厂家品牌', '厂家型号', 'SKU：SKU1', '可选商品']) expect(html).toContain(label);
    expect(html).toContain('aria-pressed="true"');
    expect(products[3].brand).toBe('');
  });
  it('does not change input product ordering or contents while searching', () => {
    const before = JSON.stringify(products);
    expect(filterPickerProducts(products, 'not found')).toEqual([]);
    filterPickerProducts(products, '');
    expect(JSON.stringify(products)).toBe(before);
  });
});
