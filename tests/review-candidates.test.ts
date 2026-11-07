import { describe, it, expect } from 'vitest';
import {readFileSync} from 'node:fs';
import {haidaAdapter as adapter} from '../src/brands/haida/adapter';
import {buildBrandIndex, matchRow} from '../src/core/matcher';
import {rememberReviewedAlias} from '../src/core/review-candidates';
import {readAliases} from '../src/core/aliases';
import {createNewProductWorkbook, readInboundWorkbook, buildInboundRows, buildImportRows} from '../src/core/excel';
import {resolveResult} from '../src/core/workflow';
import * as XLSX from 'xlsx';
import type {Catalog} from '../src/core/types';
const catalog = JSON.parse(readFileSync('public/catalog.json','utf8')) as Catalog;
const index = buildBrandIndex(catalog,adapter);
const hd = 'HAIDA 225/55R12C 6PR 93N HD506';
const tf = 'TIANFU 155R13LT 8PR 90/88S RD-104';
const product = index.byCode.get('HD506-225/55R12C')!;
const saved = rememberReviewedAlias(hd,product,adapter,'海大',index);
const aliases = {[hd]:saved};
describe('bounded candidate confirmation',()=>{
 it('shows suffix and missing ply without automatically matching',()=>{
  const r=matchRow(1,hd,adapter,index,{},'海大'); expect(r.status).toBe('review');
  const c=r.candidates.find(c=>c.product.code===product.code)!;expect(c.origin).toBe('pattern_suffix');expect(c.reason).toContain('HD506EVT');expect(c.reason).toContain('6PR');
 });
 it('keeps multiple suffix candidates pending and excludes other base patterns',()=>{
  const products=[product,{...product,code:'SECOND',spec:'225/55R12C 6PR 93N HD506SP'},{...product,code:'WRONG',spec:'225/55R12C 6PR 93N HD517'}];
  const r=matchRow(1,hd,adapter,buildBrandIndex({...catalog,products},adapter),{},'海大');
  expect(r.status).toBe('review');expect(r.product).toBeUndefined();expect(r.candidates.map(c=>c.product.code).sort()).toEqual([product.code,'SECOND'].sort());
 });
 it('reuses only the reviewed SKU after memory serialization',()=>{
  const r=matchRow(1,hd,adapter,index,readAliases(JSON.parse(JSON.stringify(aliases))),'海大');expect(r.status).toBe('matched');expect(r.product?.code).toBe(product.code);
 });
 it.each([hd.replace('6PR','8PR'),hd.replace('93N','94N'),hd+' PRO',hd.replace('HD506','HD506EVT'),hd.replace('225/55','225/65')])('does not extend confirmation to changed source %s',model=>{
  expect(matchRow(1,model,adapter,index,aliases,'海大').method).not.toBe('alias');
 });
 it('invalidates a changed brand column or catalog snapshot',()=>{
  expect(matchRow(1,hd,adapter,index,aliases,'天府').status).toBe('review');
  const changed=buildBrandIndex({...catalog,products:catalog.products.map(p=>p.code===product.code?{...p,spec:p.spec+' PRO'}:p)},adapter);
  const r=matchRow(1,hd,adapter,changed,aliases,'海大');expect(r.status).toBe('review');expect(r.candidates.some(c=>c.product.code===product.code)).toBe(true);expect(r.trace.memoryState).toContain('失效');
 });
 it('does not grant legacy memories permission to cross EVT',()=>{
  const {confirmation,...legacy}=saved;expect(matchRow(1,hd,adapter,index,{[hd]:legacy},'海大').status).toBe('review');
 });
 it('finds and remembers conflicting Tianfu without rewriting source brand',()=>{
  const r=matchRow(1,tf,adapter,index,{},'海大');expect(r.parsed?.brand).toBe('海大');expect(r.status).toBe('review');
  const target=r.candidates.find(c=>c.product.code==='TFPD6')!.product;
  const memory={[tf]:rememberReviewedAlias(tf,target,adapter,'海大',index)};
  expect(matchRow(1,tf,adapter,index,memory,'海大').product?.code).toBe('TFPD6');
  expect(matchRow(1,tf,adapter,index,memory,'天府').status).toBe('review');
 });
 it('recomputes exact match when old memory is stale but still requires confirmation',()=>{
  const model='HAIDA 175R14LT 6PR 94/92R HD517';
  const r=matchRow(1,model,adapter,index,{[model]:'HD517-175R14LT94/92R'},'海大');expect(r.status).toBe('review');expect(r.candidates[0].product.code).toBe('HD517-175R14LT94/92R');expect(r.trace.originalResult).toBe('matched');
 });
});
const fixture=process.env.NOVEMBER_TEST_WORKBOOK;
describe.skipIf(!fixture)('November source workbook',()=>{
 it('preserves real row inputs through review, export and diagnostic report',async()=>{
  const b=await readInboundWorkbook(new File([readFileSync(fixture!)],'order.xlsx'),adapter);
  const rows=buildInboundRows(b,{...b.mapping,price:'底价'},'海大');
  const results=rows.map(r=>matchRow(r.rowNumber,r.model,adapter,index,{},r.brand));
  const source=rows.find(r=>r.model.includes('TIANFU'))!;
  const original=results.find(r=>r.trace.rowNumber===source.rowNumber)!;
  expect(original.status).toBe('review');
  const reviewed=resolveResult(original,source,index,'TFPD6');expect(reviewed.status).toBe('matched');
  expect(buildImportRows([source],new Map([[source.rowNumber,index.byCode.get('TFPD6')!]]),adapter.supplierName)[0]).toMatchObject({code:'TFPD6',qty:40});
  const report=createNewProductWorkbook([source],adapter.supplierName,'底价',{results,catalogVersion:catalog.version,appVersion:'test'});
  const data=XLSX.utils.sheet_to_json<any[]>(report.Sheets[report.SheetNames[0]],{header:1});expect(data[1][10]).toBe('review');expect(data[1][12]).toContain('TFPD6');expect(data[1][14]).toBe(catalog.version);
 });
});
