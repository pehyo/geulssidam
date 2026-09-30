export const PAGE={w:595.28,h:841.89};
export type GuideLayout={cols:number;rows:number;perPage:number;marginX:number;top:number;gridW:number;gridH:number};
export const LAYOUT:GuideLayout={cols:8,rows:12,perPage:96,marginX:12,top:24,gridW:186,gridH:260};
export function box(i:number){const l=LAYOUT,cw=l.gridW/l.cols,ch=l.gridH/l.rows,n=i%l.perPage;return {x:l.marginX+(n%l.cols)*cw,y:l.top+Math.floor(n/l.cols)*ch,w:cw,h:ch};}
export function cellParts(i:number){const b=box(i),dividerY=b.y+b.h*.25;return {cell:b,dividerY,writing:{x:b.x+b.w*.10,y:b.y+b.h*.32,w:b.w*.80,h:b.h*.60}};}
