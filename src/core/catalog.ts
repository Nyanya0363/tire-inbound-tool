import type { Catalog } from './types';

export async function loadCatalog(): Promise<Catalog> {
  const url = `${import.meta.env.BASE_URL}catalog.json`;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`商品目录加载失败：${response.status} ${response.statusText}`);
  }
  const catalog = (await response.json()) as Catalog;
  if (!Array.isArray(catalog.products)) {
    throw new Error('商品目录格式不正确');
  }
  return catalog;
}
