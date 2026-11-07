import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {haidaAdapter as a} from '../src/brands/haida/adapter';
import {buildBrandIndex,matchRow} from '../src/core/matcher';
const c=JSON.parse(readFileSync('public/catalog.json','utf8'));
it('finds Tianfu despite supplier brand column and requires conflict review',()=>{const r=matchRow(1,'TIANFU 155R13LT 8PR 90/88S RD-104',a,buildBrandIndex(c,a),{},'海大');expect(r.status).toBe('review');expect(r.candidates[0].product.code).toBe('TFPD6');});
it.each([['HAIDA 175R14LT 6PR 94/92R HD517','HD517-175R14LT94/92R'],['HAIDA 225/55R12C 6PR 93N HD506','HD506-225/55R12C']])('finds confirmed existing product %s',(m,code)=>{const r=matchRow(1,m,a,buildBrandIndex(c,a),{},'海大');expect(r.status).toBe('matched');expect(r.product?.code).toBe(code);});
