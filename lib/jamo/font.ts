import opentype from "opentype.js";
import {ALL_SYLLABLES,CHOSEONG,COMPAT_JAMO,JONGSEONG,JUNGSEONG,decompose,type Parts} from "./hangul";
import type {GlyphRaster} from "./extract";
import {glyph,normalizedTarget,type Region} from "./raster";
import {contoursAt,directPath,emitContours,jamoPath,makeField,rawStroke,strokeTarget,type Field} from "./glyphs";
import {JONG_PAIRS,deriveJongTemplates,learnLayouts,makeTemplate,place,shapeAgreement,synthesizeJong,union,type Layout,type Placed,type Templates} from "./compose";

const W=384,MAX_OFFSET=12;
/** 분리해 낸 겹받침이 홑받침 조합 모양과 이만큼도 닮지 않으면 분리가 틀린 것으로 봅니다(합성 시험에서 제대로 분리된 ㄽ ≈ .89, ㄹ 윗획이 잘린 ㄽ ≈ .68). */
const SHAPE_MIN=.7;
type Cache={fields:Map<string,Field>;contours:Map<string,ReturnType<typeof contoursAt>>};

/** 자모 템플릿의 윤곽을 획 두께 보정(윤곽을 offset px만큼 바깥/안쪽으로)해 추적합니다. 거리장은 자모마다 한 번만 만들고, 윤곽은 0.25px 단위로 캐시합니다. */
function variant(it:Placed,offset:number,cache:Cache){
 const id=`${it.slot}${it.idx}`,q=Math.round(offset*4)/4,k=`${id}|${q}`,hit=cache.contours.get(k);if(hit)return hit;
 let F=cache.fields.get(id);if(!F){F=makeField(it.t.r,it.t.region,MAX_OFFSET);cache.fields.set(id,F)}
 const c=contoursAt(F,q);cache.contours.set(k,c);return c
}

/** 학습한 배치로 자모를 조합한 글자 윤곽. 직접 쓴 글자와 같은 크기 규칙(.88 박스)과 획 두께를 맞춥니다. */
function composed(parts:Parts,layouts:Map<string,Layout>,T:Templates,target:number,cache:Cache){
 const placed=place(parts,layouts,T),U=union(placed.map(p=>p.box)),box=normalizedTarget(U,placed[0].t.r);
 const uw=U.x1-U.x0,uh=U.y1-U.y0,fx=(box.x1-box.x0)/uw,fy=(box.y1-box.y0)/uh,k=880/(Math.max(uw,uh)*W),path=new opentype.Path();
 for(const it of placed){
  // 작게 줄여 넣는 자모일수록 윤곽을 더 많이 바깥으로 옮겨야 목표 두께가 됩니다. 원래 획의 30% 넘게는 깎지 않습니다.
  const s=Math.sqrt(it.p.sx*it.p.sy),raw=rawStroke(it.t.r),offset=Math.max(-raw*.3,Math.min(MAX_OFFSET,(target-raw*s*k)/(2*s*k))),b=it.box;
  // 윤곽 좌표는 템플릿 픽셀 좌표이므로, 두꺼워져 region 밖으로 나간 부분도 같은 변환으로 자연스럽게 따라갑니다.
  emitContours(path,variant(it,offset,cache),it.t.r,it.t.region,{x0:box.x0+(b.x0-U.x0)*fx,y0:box.y0+(b.y0-U.y0)*fy,x1:box.x0+(b.x1-U.x0)*fx,y1:box.y0+(b.y1-U.y0)*fy})
 }
 return path
}

export type BuiltFont={font:opentype.Font;weak:string[];samples:number;synthesized:string[]};

export async function buildFont(rs:GlyphRaster[],name:string,onProgress?:(n:number)=>void):Promise<BuiltFont>{
 const missing=rs.filter(r=>r.ink<55);if(missing.length)throw new Error(`빈 칸 또는 인식 실패 ${missing.length}개를 먼저 보완해 주세요.`);
 const T:Templates={cho:new Map(),jung:new Map(),jong:new Map()};
 for(const r of rs){if(r.kind!=="cho"&&r.kind!=="jung")continue;const list=r.kind==="cho"?CHOSEONG:JUNGSEONG,i=list.indexOf(r.char);if(i>=0)T[r.kind].set(i,makeTemplate(r))}
 if(T.cho.size<19||T.jung.size<21)throw new Error(`자모 칸이 부족합니다: 초성 ${T.cho.size}/19, 중성 ${T.jung.size}/21`);
 const jongSamples=rs.filter(r=>r.kind==="jong");
 const {jong,weak:derivedWeak,best}=await deriveJongTemplates(jongSamples,T.cho,T.jung,n=>onProgress?.(Math.round(n*.1)));
 T.jong=jong;
 // 겹받침 분리가 실패했거나(없음·정합 점수 낮음) 분리 결과가 홑받침 두 개를 나란히 놓은 모양과 너무 다르면, 홑받침 템플릿을 조합한 모양으로 바꿉니다.
 const synthesized:string[]=[];
 for(const [key,[ia,ib]] of Object.entries(JONG_PAIRS)){
  const idx=Number(key),a=jong.get(ia),b=jong.get(ib);if(!a||!b)continue;
  const synth=synthesizeJong(JONGSEONG[idx],a,b),cur=jong.get(idx);
  if(!cur||(best.get(idx)??0)<.5||shapeAgreement(cur,synth)<SHAPE_MIN){jong.set(idx,synth);synthesized.push(JONGSEONG[idx])}
 }
 const jongWeak=derivedWeak.filter(c=>!synthesized.includes(JONGSEONG[decompose(c)!.jong]));
 if(T.jong.size<JONGSEONG.length-1){const missingJong=JONGSEONG.slice(1).filter((_,i)=>!T.jong.has(i+1));throw new Error(`받침 ${missingJong.join(" ")}의 모양을 분리하지 못했습니다. 해당 받침이 든 칸을 다시 써 보세요.`)}
 const samples=rs.filter(r=>r.kind==="syl");
 const {layouts,weak}=await learnLayouts(samples,T,n=>onProgress?.(10+Math.round(n*.2)));
 const target=strokeTarget(samples),direct=new Map(samples.map(r=>[r.char,r])),cache:Cache={fields:new Map(),contours:new Map()};
 const glyphs=[new opentype.Glyph({name:".notdef",unicode:0,advanceWidth:720,path:new opentype.Path()}),new opentype.Glyph({name:"space",unicode:32,advanceWidth:400,path:new opentype.Path()})];
 // 완성형 2,350자뿐 아니라 "갂"처럼 드물게 쓰는 글자까지 한글 음절 11,172자 전체를 조합합니다.
 for(let i=0;i<ALL_SYLLABLES.length;i++){
  const c=ALL_SYLLABLES[i],r=direct.get(c);
  glyphs.push(glyph(c,r?directPath(r,target):composed(decompose(c)!,layouts,T,target,cache)));
  if(i%100===99){onProgress?.(30+Math.round((i+1)/ALL_SYLLABLES.length*70));await new Promise(res=>setTimeout(res))}
 }
 // 홀로 쓰는 자모: 초성·중성은 단독으로 쓴 칸, 겹받침(ㄳ, ㄺ 등)은 조합 글자에서 분리해 낸 받침 모양을 씁니다.
 for(const c of COMPAT_JAMO){
  const t=T.jung.get(JUNGSEONG.indexOf(c))??T.cho.get(CHOSEONG.indexOf(c))??T.jong.get(JONGSEONG.indexOf(c));
  if(t)glyphs.push(glyph(c,jamoPath(t.r,target)))
 }
 const allWeak=[...new Set([...jongWeak,...weak])];
 return {font:new opentype.Font({familyName:name.trim()||"MyHandwriting",styleName:"Regular",unitsPerEm:1000,ascender:850,descender:-150,glyphs}),weak:allWeak,samples:samples.length,synthesized}
}
export {downloadFont} from "./raster";
