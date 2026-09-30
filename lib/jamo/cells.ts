import {CHOSEONG,JUNGSEONG,JONGSEONG,COMMERCIAL_2350,ALL_SYLLABLES,decompose,isVertical,layoutClass} from "./hangul";

export type CellKind="cho"|"jung"|"jong"|"syl";
export type GuideCell={kind:CellKind;char:string};

export const KIND_LABEL:Record<CellKind,string>={cho:"초성",jung:"중성",jong:"받침",syl:"조합"};
export const KIND_TINT:Record<CellKind,string>={cho:"#eef4ea",jung:"#e9f0f7",jong:"#f7eee6",syl:"#f1ecf6"};

const QUOTA:Record<string,number>={VSN:4,VSF:4,HSN:4,HSF:4,VCN:3,VCF:3,HCN:3,HCF:3};
const COMMON_CHO=new Set([0,2,3,5,6,7,9,11,12,18]),COMMON_JUNG=new Set([0,1,4,5,8,9,11,13,14,16,18,19,20]),COMMON_JONG=new Set([1,4,8,16,17,19,21]);

/** 분류(받침 유무·모음 구조)마다 초성·모음·받침이 고르게 섞이도록 조합 글자를 고릅니다. */
function pickSamples(){
 const byClass=new Map<string,string[]>();
 for(const c of COMMERCIAL_2350){const p=decompose(c);if(!p)continue;const k=layoutClass(p);if(!byClass.has(k))byClass.set(k,[]);byClass.get(k)!.push(c)}
 const out:string[]=[];
 for(const k of Object.keys(QUOTA)){
  const pool=byClass.get(k)??[],chosen:string[]=[],cho=new Set<number>(),jung=new Set<number>(),jong=new Set<number>(),want=Math.min(QUOTA[k],pool.length);
  while(chosen.length<want){
   let best="",gain=-1;
   for(const c of pool){if(chosen.includes(c))continue;const p=decompose(c)!,g=(cho.has(p.cho)?0:COMMON_CHO.has(p.cho)?3:1)+(jung.has(p.jung)?0:COMMON_JUNG.has(p.jung)?3:1)+(p.jong&&!jong.has(p.jong)?COMMON_JONG.has(p.jong)?2:.5:0);if(g>gain){gain=g;best=c}}
   const p=decompose(best)!;chosen.push(best);cho.add(p.cho);jung.add(p.jung);jong.add(p.jong)
  }
  out.push(...chosen)
 }
 return out
}

export const SAMPLE_CHARS=pickSamples();

const JONG_PER=2,SIMPLE_VERTICAL=new Set([0,4,20]);
/**
 * 받침 자모마다, 그 받침을 실제로 쓰는 글자를 초성·모음이 겹치지 않게 몇 개씩 골라 실제 모양을 분석할 수 있게 합니다.
 * 가로 모음(ㅗ·ㅡ…) 글자에서는 모음 가로획이 받침 윗획(ㄹ·ㅍ 등)과 비슷해 받침 분리가 자주 틀리므로 세로 모음 글자만 씁니다.
 * ㄽ(곬·돐·옰)·ㄿ(읊)처럼 상용 2,350자에 세로 모음 글자가 없는 받침은 "갌"처럼 전체 음절에서 흔한 초성 + ㅏ·ㅓ·ㅣ 글자로 채웁니다.
 */
function pickJongSamples(){
 const out:string[]=[];
 for(let j=1;j<JONGSEONG.length;j++){
  const vertical=(c:string)=>{const p=decompose(c);return !!p&&p.jong===j&&isVertical(p.jung)};
  const common=COMMERCIAL_2350.filter(vertical),extra=ALL_SYLLABLES.filter(c=>{if(!vertical(c)||common.includes(c))return false;const p=decompose(c)!;return COMMON_CHO.has(p.cho)&&SIMPLE_VERTICAL.has(p.jung)});
  const chosen:string[]=[],cho=new Set<number>(),jung=new Set<number>();
  // 상용 글자를 먼저 고르고, 모자라면 전체 음절에서 채웁니다.
  for(const pool of [common,extra]){
   const want=Math.min(JONG_PER,chosen.length+pool.length);
   while(chosen.length<want){
    let best="",gain=-1;
    for(const c of pool){if(chosen.includes(c))continue;const p=decompose(c)!,g=(cho.has(p.cho)?0:COMMON_CHO.has(p.cho)?3:1)+(jung.has(p.jung)?0:COMMON_JUNG.has(p.jung)?3:1);if(g>gain){gain=g;best=c}}
    const p=decompose(best)!;chosen.push(best);cho.add(p.cho);jung.add(p.jung)
   }
  }
  out.push(...chosen)
 }
 return out
}
export const JONG_SAMPLES=pickJongSamples();

export const GUIDE_CELLS:GuideCell[]=[
 ...CHOSEONG.map(char=>({kind:"cho" as const,char})),
 ...JUNGSEONG.map(char=>({kind:"jung" as const,char})),
 ...JONG_SAMPLES.map(char=>({kind:"jong" as const,char})),
 ...SAMPLE_CHARS.map(char=>({kind:"syl" as const,char})),
];
/** 종류별 1부터 시작하는 칸 번호 범위 */
export function cellRanges(){const out:Array<{kind:CellKind;from:number;to:number}>=[];GUIDE_CELLS.forEach((c,i)=>{const last=out[out.length-1];if(last&&last.kind===c.kind)last.to=i+1;else out.push({kind:c.kind,from:i+1,to:i+1})});return out}
