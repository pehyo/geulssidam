export const CHOSEONG=["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export const JUNGSEONG=["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
export const JONGSEONG=["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export type Parts={cho:number;jung:number;jong:number};
export function decompose(c:string):Parts|null { const n=c.charCodeAt(0)-0xac00; if(n<0||n>11171)return null; return {cho:Math.floor(n/588),jung:Math.floor((n%588)/28),jong:n%28}; }
const eucKr=new TextDecoder("euc-kr");
export const COMMERCIAL_2350=Array.from({length:25*94},(_,i)=>eucKr.decode(Uint8Array.of(0xb0+Math.floor(i/94),0xa1+i%94)));
/** 한글 음절 전체(가 U+AC00 ~ 힣 U+D7A3, 11,172자) */
export const ALL_SYLLABLES=Array.from({length:11172},(_,i)=>String.fromCharCode(0xac00+i));
/** 한글 호환 자모(ㄱ U+3131 ~ ㅣ U+3163): 자모만 홀로 입력할 때 쓰이는 문자 */
export const COMPAT_JAMO=Array.from({length:0x3163-0x3131+1},(_,i)=>String.fromCharCode(0x3131+i));
const COMPLEX_JUNG=new Set([9,10,11,14,15,16,19]);
export type Structure={vertical:boolean;complex:boolean;hasFinal:boolean};
export function isVertical(j:number){return ![8,9,10,11,12,13,14,15,16,17,18].includes(j)}
export function structure(p:Parts):Structure{return {vertical:isVertical(p.jung),complex:COMPLEX_JUNG.has(p.jung),hasFinal:p.jong>0}}
/** 배치 분류: V/H(세로·가로 모음) + S/C(단순·복합 모음) + N/F(받침 없음·있음) */
export function layoutClass(p:Parts){const s=structure(p);return `${s.vertical?"V":"H"}${s.complex?"C":"S"}${s.hasFinal?"F":"N"}`}
