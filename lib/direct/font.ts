import opentype from "opentype.js";
import {COMMERCIAL_2350} from "./hangul";
import type {GlyphRaster} from "./extract";
import {directPath,effectiveStroke,strokeTarget} from "../jamo/glyphs";
import {glyph} from "../jamo/raster";

/**
 * 윤곽은 자모 모드와 같은 방식(흐린 거리장의 등고선 추적)으로 만들어 픽셀 계단이 남지 않게 합니다.
 * 획 두께는 2,350자의 중앙값에서 12% 넘게 벗어난 글자만 중앙값에 맞추고, 나머지는 쓴 그대로 둡니다.
 */
export async function buildFont(rs:GlyphRaster[],name:string,onProgress?:(n:number)=>void){
 const missing=rs.filter(r=>r.ink<55);if(missing.length)throw new Error(`빈 칸 또는 인식 실패 ${missing.length}개를 먼저 보완해 주세요.`);
 const prepared=rs.map(r=>({...r,kind:"syl" as const})),target=strokeTarget(prepared),direct=new Map(prepared.map(r=>[r.char,r]));
 const glyphs=[new opentype.Glyph({name:".notdef",unicode:0,advanceWidth:720,path:new opentype.Path()}),new opentype.Glyph({name:"space",unicode:32,advanceWidth:400,path:new opentype.Path()})];
 for(let i=0;i<COMMERCIAL_2350.length;i++){
  const c=COMMERCIAL_2350[i],r=direct.get(c);if(!r)throw new Error(`${c} 글리프가 없습니다.`);
  const own=effectiveStroke(r);
  glyphs.push(glyph(c,directPath(r,Math.abs(own-target)<=target*.12?own:target)));
  if(i%50===49){onProgress?.(Math.round((i+1)/COMMERCIAL_2350.length*100));await new Promise(res=>setTimeout(res))}
 }
 return new opentype.Font({familyName:name.trim()||"MyHandwriting",styleName:"Regular",unitsPerEm:1000,ascender:850,descender:-150,glyphs})
}
export {downloadFont} from "../jamo/raster";
