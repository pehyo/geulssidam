export const PAGE={w:595.28,h:841.89};
export type GuideLayout={cols:number;rows:number;perPage:number;marginX:number;top:number;gridW:number;gridH:number};
/** 6열 × 8행. 글자 영역이 거의 정사각형(약 25×23mm)이 되도록 잡았습니다. */
export const LAYOUT:GuideLayout={cols:6,rows:8,perPage:48,marginX:12,top:24,gridW:186,gridH:256};
export function box(i:number){const l=LAYOUT,cw=l.gridW/l.cols,ch=l.gridH/l.rows,n=i%l.perPage;return {x:l.marginX+(n%l.cols)*cw,y:l.top+Math.floor(n/l.cols)*ch,w:cw,h:ch};}
export function cellParts(i:number){const b=box(i),dividerY=b.y+b.h*.17;return {cell:b,dividerY,writing:{x:b.x+b.w*.09,y:b.y+b.h*.22,w:b.w*.82,h:b.h*.72}};}
