import {it,expect} from 'vitest';
import {haidaAdapter as a} from '../src/brands/haida/adapter';
import {buildBrandIndex,matchRow} from '../src/core/matcher';
import {rememberReviewedAlias} from '../src/core/review-candidates';
import type {Product} from '../src/core/types';
const p:Product={code:'CORE',name:'轮胎',brand:'海大',unit:'条',spec:'225/55R12C 6PR HD506'};
const index=(products:Product[])=>buildBrandIndex({version:'test',generatedAt:'',products},a);
it('preserves manual fallback for unparseable models',()=>{
 const i=index([p]);const m='无法解析的厂家型号';const entry=rememberReviewedAlias(m,p,a,'海大',i);
 expect(entry.confirmation).toBeUndefined();expect(matchRow(1,m,a,i,{[m]:entry},'海大').product?.code).toBe('CORE');
});
it('retains the core product ahead of eight suffix candidates',()=>{
 const i=index([p,...Array.from({length:9},(_,n)=>({...p,code:'SUFFIX'+n,spec:'225/55R12C 6PR 93N HD506EVT'}))]);
 const r=matchRow(1,'HAIDA 225/55R12C 6PR 93N HD506',a,i,{},'海大');
 expect(r.status).toBe('review');expect(r.candidates).toHaveLength(8);expect(r.candidates[0].product.code).toBe('CORE');expect(new Set(r.candidates.map(c=>c.product.code)).size).toBe(8);
});
it('explains changed target units with old and new values',()=>{
 const target={...p,spec:'225/55R12C HD506EVT 93N'};const i=index([target]);const m='HAIDA 225/55R12C 6PR 93N HD506';
 const entry=rememberReviewedAlias(m,target,a,'海大',i);
 const r=matchRow(1,m,a,index([{...target,unit:'件'}]),{[m]:entry},'海大');
 expect(r.status).toBe('review');expect(r.reason).toContain('目录单位变化：条 → 件');
});

it('rechecks every target snapshot field and deletion',()=>{
 const target={...p,spec:'225/55R12C HD506EVT 93N'},m='HAIDA 225/55R12C 6PR 93N HD506';
 const entry=rememberReviewedAlias(m,target,a,'海大',index([target]));
 for(const [field,value,label] of [['spec',target.spec+' PRO','目录规格'],['brand','天府','目录品牌'],['unit','件','目录单位']]){
  const r=matchRow(1,m,a,index([{...target,[field]:value}]),{[m]:entry},'海大');
  expect(r.status).toBe('review');expect(r.reason).toContain(label+'变化');expect(r.trace.memoryInvalidations?.some(item=>item.field===field)).toBe(true);
 }
 expect(matchRow(1,m,a,index([]),{[m]:entry},'海大').reason).toContain('已不在当前目录');
});
it('preserves structured source snapshots through JSON and rejects malformed optional snapshots',async()=>{
 const {readAliases}=await import('../src/core/aliases');
 const target={...p,spec:'225/55R12C HD506EVT 93N'},m='HAIDA 225/55R12C 6PR 93N HD506';
 const entry=rememberReviewedAlias(m,target,a,'海大',index([target]));
 const roundtrip=readAliases(JSON.parse(JSON.stringify({[m]:entry})))[m];expect(roundtrip).toEqual(entry);
 const malformed=readAliases({[m]:{...entry,confirmation:{...entry.confirmation,sourceSnapshot:{flags:42}}}})[m];
 expect(typeof malformed==='object'&&malformed.confirmation?.sourceSnapshot).toBeUndefined();
});
it('explains source fields and missing historical snapshots without guessing',async()=>{
 const {validateReviewedMemory}=await import('../src/core/review-candidates');
 const target={...p,spec:'225/55R12C HD506EVT 93N'},m='HAIDA 225/55R12C 6PR 93N HD506';const i=index([target]);
 const entry=rememberReviewedAlias(m,target,a,'海大',i);const next=m.replace('6PR','8PR');
 expect(validateReviewedMemory(entry,next,'海大',a.parseInbound(next,'海大'),i,a).reasons.map(r=>r.message).join()).toContain('来源层级变化：6PR → 8PR');
 delete entry.confirmation!.sourceSnapshot;
 expect(validateReviewedMemory(entry,next,'海大',a.parseInbound(next,'海大'),i,a).reasons.map(r=>r.message).join()).toContain('旧记录未保存');
 expect(matchRow(1,m,a,i,{[m]:entry},'天府').reason).toContain('来源品牌列变化：海大 → 天府');
});
it('keeps unparseable original-text memory narrow and invalidates changed targets',()=>{
 const i=index([p]),m='无法解析的厂家型号';const entry=rememberReviewedAlias(m,p,a,'海大',i);
 expect(matchRow(1,m+'其他',a,i,{[m]:entry},'海大').status).not.toBe('matched');
 expect(matchRow(1,m,a,index([{...p,unit:'件'}]),{[m]:entry},'海大').reason).toContain('目录单位变化：条 → 件');
});
