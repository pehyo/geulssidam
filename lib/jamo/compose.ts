import {removeSpecks,type GlyphRaster} from "./extract";
import {decompose,layoutClass,structure,type Parts,type Structure} from "./hangul";
import {inkRegion,normalizedTarget,type Region} from "./raster";

export type Slot="cho"|"jung"|"jong";
/** 자모 하나의 배치: 중심(cx,cy)과, 단독으로 쓴 자모 크기 대비 배율(sx,sy). 좌표는 글자 전체를 .88 박스에 맞춘 정규화 좌표. */
export type Param={cx:number;cy:number;sx:number;sy:number};
export type Layout={cho:Param;jung:Param;jong:Param|null;count:number};
export type Template={r:GlyphRaster;region:Region;nw:number;nh:number;bin:Uint8Array};
export type Templates={cho:Map<number,Template>;jung:Map<number,Template>;jong:Map<number,Template>};
export type Placed={slot:Slot;idx:number;t:Template;p:Param;box:Region};

const G=64,TS=64,MIN_SIZE=1/384;
const STAGES=[{pos:.04,sc:.12,R:3},{pos:.02,sc:.06,R:2},{pos:.01,sc:.03,R:1},{pos:.005,sc:.015,R:1}];

/** region 안을 n×n 칸으로 나눠 잉크가 조금이라도 있는 칸을 1로 표시 */
function bins(r:GlyphRaster,reg:Region,n:number){
 const px0=Math.round(reg.x0*r.width),py0=Math.round(reg.y0*r.height),pw=Math.max(1,Math.round(reg.x1*r.width)-px0),ph=Math.max(1,Math.round(reg.y1*r.height)-py0),out=new Uint8Array(n*n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const xa=px0+Math.floor(i*pw/n),xb=Math.min(r.width,Math.max(xa+1,px0+Math.floor((i+1)*pw/n))),ya=py0+Math.floor(j*ph/n),yb=Math.min(r.height,Math.max(ya+1,py0+Math.floor((j+1)*ph/n)));
  let s=0,c=0;for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){c++;s+=r.data[y*r.width+x]}
  out[j*n+i]=c&&s/c>.2?1:0
 }
 return out
}

export function makeTemplate(r:GlyphRaster):Template{
 const region=inkRegion(r,0);
 return {r,region,nw:Math.max(MIN_SIZE,region.x1-region.x0),nh:Math.max(MIN_SIZE,region.y1-region.y0),bin:bins(r,region,TS)}
}

/** 손으로 정한 초기 배치(분석의 출발점이자 분석이 실패했을 때의 대체값) */
export function priorBox(s:Structure,slot:Slot):Region{
 if(slot==="jong")return {x0:.09,y0:.66,x1:.91,y1:.95};
 if(slot==="cho")return s.vertical?{x0:.05,y0:.07,x1:.49,y1:s.hasFinal?.61:.93}:{x0:.07,y0:.05,x1:.93,y1:s.hasFinal?.39:.49};
 return s.vertical?{x0:.48,y0:.07,x1:.95,y1:s.hasFinal?.61:.93}:{x0:.07,y0:.38,x1:.93,y1:s.hasFinal?.68:.93}
}
function boxOf(p:Param,t:Template):Region{const w=p.sx*t.nw,h=p.sy*t.nh;return {x0:p.cx-w/2,y0:p.cy-h/2,x1:p.cx+w/2,y1:p.cy+h/2}}
/** 슬롯 박스 안에 자모를 비율 유지로 꽉 채워 넣은 배치 */
function paramOf(b:Region,t:Template):Param{const s=Math.min((b.x1-b.x0)/t.nw,(b.y1-b.y0)/t.nh);return {cx:(b.x0+b.x1)/2,cy:(b.y0+b.y1)/2,sx:s,sy:s}}
function union(bs:Region[]):Region{return {x0:Math.min(...bs.map(b=>b.x0)),y0:Math.min(...bs.map(b=>b.y0)),x1:Math.max(...bs.map(b=>b.x1)),y1:Math.max(...bs.map(b=>b.y1))}}

function slotsOf(parts:Parts):Array<[Slot,number]>{return [["cho",parts.cho],["jung",parts.jung],...(parts.jong?[["jong",parts.jong] as [Slot,number]]:[])]}

function render(ps:Param[],ts:Template[],out:Uint8Array){
 out.fill(0);
 ps.forEach((p,k)=>{
  const t=ts[k],b=boxOf(p,t),bw=b.x1-b.x0,bh=b.y1-b.y0,gx0=Math.max(0,Math.floor(b.x0*G)),gx1=Math.min(G,Math.ceil(b.x1*G)),gy0=Math.max(0,Math.floor(b.y0*G)),gy1=Math.min(G,Math.ceil(b.y1*G));
  for(let gy=gy0;gy<gy1;gy++){const v=((gy+.5)/G-b.y0)/bh;if(v<0||v>=1)continue;const row=Math.floor(v*TS)*TS;for(let gx=gx0;gx<gx1;gx++){const u=((gx+.5)/G-b.x0)/bw;if(u<0||u>=1)continue;if(t.bin[row+Math.floor(u*TS)])out[gy*G+gx]=1}}
 })
}
function dilate(src:Uint8Array,R:number,dst:Uint8Array,tmp:Uint8Array){
 for(let y=0;y<G;y++)for(let x=0;x<G;x++){let m=0;for(let d=-R;d<=R&&!m;d++){const xx=x+d;if(xx>=0&&xx<G&&src[y*G+xx])m=1}tmp[y*G+x]=m}
 for(let y=0;y<G;y++)for(let x=0;x<G;x++){let m=0;for(let d=-R;d<=R&&!m;d++){const yy=y+d;if(yy>=0&&yy<G&&tmp[yy*G+x])m=1}dst[y*G+x]=m}
}

type Fit={params:Param[];raw:Param[];score:number};

/**
 * 자모 템플릿들이 실제 글자 위 어디에·얼마나 크게 놓였는지 찾습니다. raw는 sample의 원래 좌표계(0~1) 기준 배치, params는 .88 박스 기준으로 정규화한 배치입니다.
 * caps가 있으면 해당 자모의 박스 아래쪽(y1)이 그 값을 넘는 후보는 버립니다. 모델링하지 않은 잉크(예: 받침 모양을 분리해 낼 때의 받침)가 남아 있으면
 * 겹침 점수를 높이려고 자모 박스를 그쪽으로 부풀리는 것을 막기 위한 안전장치입니다.
 */
function fitItems(sample:GlyphRaster,items:Array<[Slot,number]>,ts:Template[],s:Structure,caps?:Array<number|undefined>):Fit{
 const ink=inkRegion(sample,0),target=normalizedTarget(ink,sample);
 // 초기값: 기본 배치를 실제 글자의 잉크 영역에 맞춰 늘려 시작. 받침을 빼고 맞출 때도 잉크에는 받침이 있으므로 받침 자리까지 포함한 틀을 기준으로 삼습니다.
 const priors=items.map(([slot])=>priorBox(s,slot)),frame=s.hasFinal&&!items.some(([slot])=>slot==="jong")?[...priors,priorBox(s,"jong")]:priors;
 const U=union(frame),fx0=(ink.x1-ink.x0)/(U.x1-U.x0),fy0=(ink.y1-ink.y0)/(U.y1-U.y0);
 const start=priors.map((b,k)=>paramOf({x0:ink.x0+(b.x0-U.x0)*fx0,y0:ink.y0+(b.y0-U.y0)*fy0,x1:ink.x0+(b.x1-U.x0)*fx0,y1:ink.y0+(b.y1-U.y0)*fy0},ts[k]));
 // caps는 기본 배치 좌표로 주어지므로 같은 변환으로 실제 글자 좌표로 옮깁니다.
 caps=caps?.map(c=>c===undefined?c:ink.y0+(c-U.y0)*fy0);
 const A=bins(sample,{x0:0,y0:0,x1:1,y1:1},G),sumA=A.reduce((a,v)=>a+v,0),B=new Uint8Array(G*G),Bd=new Uint8Array(G*G),tmp=new Uint8Array(G*G),Ad=new Map<number,Uint8Array>();
 for(const R of [1,2,3]){const d=new Uint8Array(G*G);dilate(A,R,d,tmp);Ad.set(R,d)}
 const f1=(ps:Param[],R:number)=>{
  render(ps,ts,B);dilate(B,R,Bd,tmp);const Ar=Ad.get(R)!;let sb=0,pm=0,rm=0;
  for(let i=0;i<G*G;i++){if(B[i]){sb++;if(Ar[i])pm++}if(A[i]&&Bd[i])rm++}
  if(!sb||!sumA)return 0;const p=pm/sb,r=rm/sumA;return p+r?2*p*r/(p+r):0
 };
 // anchor: 벗어날수록 벌점을 주는 기준 배치(보통 start, 위로 올려 시작한 경우엔 올린 위치)
 const penalty=(ps:Param[],anchor:Param[])=>ps.reduce((a,p,k)=>a+Math.abs(p.cx-anchor[k].cx)+Math.abs(p.cy-anchor[k].cy)+.5*Math.abs(Math.log(p.sx/start[k].sx))+.5*Math.abs(Math.log(p.sy/start[k].sy)),0)*.06;
 // 좌표하강법: 큰 걸음부터 줄여 가며 각 자모의 위치·배율을 조정
 const descend=(init:Param[],anchor:Param[]=start)=>{
  // 시작값 자체가 이미 caps를 넘으면(배율을 키워 시작하는 경우 등) 아래로 넘친 만큼 위로 당겨 둡니다.
  let cur=init.map((p,k)=>{
   if(!caps||caps[k]===undefined)return {...p};
   const over=boxOf(p,ts[k]).y1-caps[k]!;
   return over>0?{...p,cy:p.cy-over}:{...p}
  });
  for(const st of STAGES){
   let best=f1(cur,st.R)-penalty(cur,anchor);
   for(let round=0;round<16;round++){
    let improved=false;
    for(let k=0;k<cur.length;k++)for(const name of ["cx","cy","sx","sy"] as const)for(const dir of [-1,1]){
     const cand=cur.map(p=>({...p})),q=cand[k];
     if(name==="cx")q.cx=Math.min(start[k].cx+.3,Math.max(start[k].cx-.3,q.cx+dir*st.pos));else if(name==="cy")q.cy=Math.min(start[k].cy+.3,Math.max(start[k].cy-.3,q.cy+dir*st.pos));else q[name]=Math.min(start[k][name]*2.2,Math.max(start[k][name]*.45,q[name]*(1+dir*st.sc)));
     if(caps&&caps[k]!==undefined&&boxOf(q,ts[k]).y1>caps[k]!)continue;
     const v=f1(cand,st.R)-penalty(cand,anchor);
     if(v>best+1e-4){cur=cand;best=v;improved=true}
    }
    if(!improved)break
   }
  }
  return {cur,score:f1(cur,1)}
 };
 // 국소 최솟값을 피하려고 초기 배율을 바꿔 여러 번 시작해 가장 잘 겹친 결과를 고름
 let cur=start,score=-1;
 if(!caps)for(const m of [1,.7,1.4]){const r=descend(start.map(p=>({...p,sx:p.sx*m,sy:p.sy*m})));if(r.score>score){score=r.score;cur=r.cur}}
 else{
  // 받침을 빼고 맞출 때는 아래쪽 받침 획(ㄹ·ㅍ의 윗가로획 등)이 가로 모음(ㅡ·ㅗ)과 비슷해, 모음을 받침 위에 겹쳐 놓아도 점수가 비슷하게 나옵니다.
  // 위로 올린 시작점도 시도하고, 점수가 거의 같으면 받침이 항상 아래에 있다는 구성 규칙에 따라 더 위에 놓인 배치를 고릅니다.
  const bottom=(ps:Param[])=>Math.max(...ps.map((p,k)=>boxOf(p,ts[k]).y1)),runs:Array<{cur:Param[];score:number}>=[];
  for(const dy of [0,-.08,-.16,-.24,-.32]){const shifted=start.map(p=>({...p,cy:p.cy+dy*(ink.y1-ink.y0)}));for(const m of [1,.7,1.4])runs.push(descend(shifted.map(p=>({...p,sx:p.sx*m,sy:p.sy*m})),shifted))}
  const best=Math.max(...runs.map(r=>r.score)),pick=runs.filter(r=>r.score>=best-.03).sort((a,b)=>bottom(a.cur)-bottom(b.cur))[0];
  cur=pick.cur;score=pick.score
 }
 const fx=(target.x1-target.x0)/(ink.x1-ink.x0),fy=(target.y1-target.y0)/(ink.y1-ink.y0);
 // 글자 크기·위치 차이를 없애기 위해 잉크 영역을 .88 박스에 맞춘 좌표로 변환
 const params=cur.map(p=>({cx:target.x0+(p.cx-ink.x0)*fx,cy:target.y0+(p.cy-ink.y0)*fy,sx:p.sx*fx,sy:p.sy*fy}));
 return {params,raw:cur,score}
}

function fit(sample:GlyphRaster,parts:Parts,T:Templates):Fit{
 const items=slotsOf(parts),ts=items.map(([slot,idx])=>T[slot].get(idx)!);
 return fitItems(sample,items,ts,structure(parts))
}

/** 받침 템플릿 없이, 이미 아는 초성·중성 템플릿만으로 조합 글자 위 위치를 찾습니다(받침 모양을 분리해 내는 용도). */
export function fitPartial(sample:GlyphRaster,items:Array<[Slot,number]>,ts:Template[],s:Structure,caps?:Array<number|undefined>):Fit{
 return fitItems(sample,items,ts,s,caps)
}

/** region 전체 해상도(sample 픽셀 크기)로 템플릿들을 렌더링 */
function renderAt(ps:Param[],ts:Template[],size:number):Uint8Array{
 const out=new Uint8Array(size*size);
 ps.forEach((p,k)=>{
  const t=ts[k],b=boxOf(p,t),bw=b.x1-b.x0,bh=b.y1-b.y0,gx0=Math.max(0,Math.floor(b.x0*size)),gx1=Math.min(size,Math.ceil(b.x1*size)),gy0=Math.max(0,Math.floor(b.y0*size)),gy1=Math.min(size,Math.ceil(b.y1*size));
  for(let gy=gy0;gy<gy1;gy++){const v=((gy+.5)/size-b.y0)/bh;if(v<0||v>=1)continue;const row=Math.floor(v*TS)*TS;for(let gx=gx0;gx<gx1;gx++){const u=((gx+.5)/size-b.x0)/bw;if(u<0||u>=1)continue;if(t.bin[row+Math.floor(u*TS)])out[gy*size+gx]=1}}
 });
 return out
}
function dilateAt(src:Uint8Array,R:number,size:number):Uint8Array{
 const tmp=new Uint8Array(size*size),dst=new Uint8Array(size*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let m=0;for(let d=-R;d<=R&&!m;d++){const xx=x+d;if(xx>=0&&xx<size&&src[y*size+xx])m=1}tmp[y*size+x]=m}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let m=0;for(let d=-R;d<=R&&!m;d++){const yy=y+d;if(yy>=0&&yy<size&&tmp[yy*size+x])m=1}dst[y*size+x]=m}
 return dst
}

/** 8방향 연결 요소(픽셀 인덱스 목록) */
function components(data:Uint8Array,w:number,h:number):number[][]{
 const seen=new Uint8Array(data.length),out:number[][]=[];
 for(let i=0;i<data.length;i++){if(!data[i]||seen[i])continue;const stack=[i],group:number[]=[];seen[i]=1;while(stack.length){const q=stack.pop()!,x=q%w,y=Math.floor(q/w);group.push(q);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&data[n]&&!seen[n]){seen[n]=1;stack.push(n)}}}out.push(group)}
 return out
}

export type JongDerivation={jong:Map<number,Template>;weak:string[];scores:Map<string,number>;best:Map<number,number>};

/**
 * 받침을 단독 칸이 아니라 "각", "낡"처럼 실제 글자로 자연스럽게 쓰게 한 뒤, 이미 학습된 초성·중성 템플릿을
 * 그 글자 위에 겹침 정합으로 맞추고 남는 잉크를 받침 모양으로 분리해 냅니다. 받침마다 여러 샘플이 있으면
 * 초성·중성 정합 점수가 가장 높은(=분리가 가장 깨끗한) 샘플을 그 받침의 템플릿으로 씁니다.
 */
export async function deriveJongTemplates(samples:GlyphRaster[],choT:Map<number,Template>,jungT:Map<number,Template>,onProgress?:(n:number)=>void):Promise<JongDerivation>{
 const weak:string[]=[],scores=new Map<string,number>(),byIdx=new Map<number,Array<{tpl:Template;score:number;clean:boolean}>>();
 for(let i=0;i<samples.length;i++){
  const r=samples[i],parts=decompose(r.char);
  if(parts&&parts.jong){
   const ct=choT.get(parts.cho),jt=jungT.get(parts.jung);
   if(ct&&jt){
    const items:Array<[Slot,number]>=[["cho",parts.cho],["jung",parts.jung]],ts=[ct,jt],s=structure(parts),caps=items.map(([slot])=>priorBox(s,slot).y1+.04),f=fitPartial(r,items,ts,s,caps);
    scores.set(r.char,f.score);if(f.score<.5)weak.push(r.char);
    const mask=renderAt(f.raw,ts,r.width),dilated=dilateAt(mask,3,r.width),data=new Uint8Array(r.data.length);
    // 받침은 한글 구성 규칙상 초성·중성보다 항상 아래에 있으므로, 실제로 맞춰진 초성·중성 아래쪽 경계보다 위는
    // 정합이 어긋나 남은 초성·중성 잔여물일 뿐 받침일 수 없습니다.
    const bottomEdge=Math.min(.95,Math.max(...f.raw.map((p,k)=>boxOf(p,ts[k]).y1))+.02),cutoffRow=Math.round(bottomEdge*r.height);
    // 획(연결 요소) 단위로 판단합니다. 초성·중성 정합 마스크와 거의 겹치지 않고 무게중심이 초성·중성 아래쪽에 있는 획은
    // 받침으로 통째로 가져옵니다. 맞춰진 박스가 받침 쪽으로 조금만 내려와도 경계선에 받침 윗부분(ㄹ·ㅎ·ㄱ의 윗획)이
    // 잘리던 문제를 막습니다.
    let maskTop=r.height,maskBottom=0;for(let i=0;i<mask.length;i++)if(mask[i]){const y=Math.floor(i/r.width);if(y<maskTop)maskTop=y;if(y>maskBottom)maskBottom=y}
    // 받침 획의 무게중심은 초성·중성 마스크 아래 끝 근처보다 아래에 옵니다. 너무 높게 잡으면 초성 ㅎ의 동그라미 같은 획이 받침으로 들어옵니다.
    const splitRow=maskTop+(maskBottom-maskTop)*.9,W=r.width;let touched=false;
    // 조합 글자 속 모음 세로획은 단독으로 쓴 모음보다 길게 내려오는 일이 많습니다(예: "갚"의 ㅏ가 ㅍ 위까지).
    // 맞춰진 중성의 맨 아래 획을 그대로 따라 내려가며, 폭이 획 굵기 그대로인 동안은 모음 꼬리로 보고 받침 후보에서 뺍니다.
    const tail=new Uint8Array(r.data.length),jm=renderAt([f.raw[1]],[ts[1]],W);let jb=-1;for(let i=jm.length-1;i>=0;i--)if(jm[i]){jb=Math.floor(i/W);break}
    if(jb>=0){
     const stems:Array<[number,number]>=[];let a=-1;for(let x=0;x<=W;x++){const on=x<W&&jm[jb*W+x]===1;if(on&&a<0)a=x;if(!on&&a>=0){stems.push([a,x-1]);a=-1}}
     // 가로 모음(ㅗ·ㅜ 등)의 가로획처럼 넓은 구간은 세로획 꼬리가 아니므로 따라가지 않습니다.
     for(const [x0,x1] of stems){if(x1-x0+1>W*.06)continue;
      const m=Math.max(3,Math.round((x1-x0+1)*.6));let lo=x0-m,hi=x1+m;
      for(let y=jb+1;y<r.height;y++){
       let s0=-1;for(let x=Math.max(0,lo);x<=Math.min(W-1,hi);x++)if(r.data[y*W+x]){s0=x;break}
       if(s0<0)break;
       let e0=s0,b0=s0;while(b0>0&&r.data[y*W+b0-1])b0--;while(e0<W-1&&r.data[y*W+e0+1])e0++;
       if(e0-b0+1>(x1-x0+1)+2*m)break;
       for(let x=b0;x<=e0;x++)tail[y*W+x]=1;lo=b0-m;hi=e0+m
      }
     }
    }
    for(const comp of components(r.data,W,r.height)){
     let below=0,covered=0,sy=0;for(const q of comp){const y=Math.floor(q/W);sy+=y;if(y>=cutoffRow)below++;if(dilated[q])covered++}
     if(covered/comp.length<.2&&sy/comp.length>splitRow){for(const q of comp)data[q]=1;continue}
     if(below/comp.length<=.15&&sy/comp.length<=splitRow)continue;
     // 초성·중성과 이어 쓴 획(예: "각"에서 ㅏ 세로획이 ㄱ 윗획에 닿음): 정합 마스크를 걷어낸 나머지 조각 중 아래쪽에 있는 것만 받침으로 남깁니다.
     const rest=new Uint8Array(r.data.length);for(const q of comp)if(!dilated[q]&&!tail[q])rest[q]=1;
     const kept:number[]=[];
     for(const piece of components(rest,W,r.height)){let py=0;for(const q of piece)py+=Math.floor(q/W);if(py/piece.length>splitRow)for(const q of piece){data[q]=1;kept.push(q)}}
     if(kept.length)touched=true;
     // 모음 획이 지나가며 받침 획을 끊어 놓은 자리는, 같은 행(또는 열)의 양쪽에 받침 잉크가 있을 때만 원래 잉크로 메웁니다.
     if(kept.length){const D=Math.round(W*.04),has=(x:number,y:number)=>x>=0&&x<W&&y>=0&&y<r.height&&data[y*W+x]===1,fill:number[]=[];
      for(const q of comp){if(data[q]||!dilated[q]||tail[q])continue;const x=q%W,y=Math.floor(q/W);let l=false,rt=false,u=false,d=false;for(let k=1;k<=D;k++){l||=has(x-k,y);rt||=has(x+k,y);u||=has(x,y-k);d||=has(x,y+k)}if(l&&rt||u&&d)fill.push(q)}
      for(const q of fill)data[q]=1}
    }
    removeSpecks(data,r.width,r.height,Math.max(5,Math.round(r.width*r.height*.00025)));
    const ink=data.reduce((a,v)=>a+v,0);
    if(ink>=20){
     const tpl=makeTemplate({char:r.char,kind:"jong",width:r.width,height:r.height,data,ink}),list=byIdx.get(parts.jong)??[];
     list.push({tpl,score:f.score,clean:!touched});byIdx.set(parts.jong,list)
    }
   }
  }
  onProgress?.(Math.round((i+1)/samples.length*100));await new Promise(res=>setTimeout(res))
 }
 const jong=new Map<number,Template>(),best=new Map<number,number>();
 // 받침을 모음과 떨어뜨려 쓴 샘플은 픽셀을 걷어낼 필요 없이 획이 온전하므로 우선하고, 그다음 정합 점수가 높은 샘플을 고릅니다.
 for(const [idx,list] of byIdx){list.sort((a,b)=>Number(b.clean)-Number(a.clean)||b.score-a.score);jong.set(idx,list[0].tpl);best.set(idx,list[0].score)}
 return {jong,weak,scores,best}
}

/** 겹받침을 이루는 홑받침 두 개(JONGSEONG 번호) */
export const JONG_PAIRS:Record<number,[number,number]>={3:[1,19],5:[4,22],6:[4,27],9:[8,1],10:[8,16],11:[8,17],12:[8,19],13:[8,25],14:[8,26],15:[8,27],18:[17,19]};

/** 홑받침 두 템플릿을 좌우로 나란히 놓아 겹받침 템플릿을 만듭니다. 조합 글자에서 겹받침을 제대로 분리하지 못했을 때의 대체값입니다. */
export function synthesizeJong(char:string,a:Template,b:Template):Template{
 const W=a.r.width,H=a.r.height,data=new Uint8Array(W*H),half=.45;
 // 두 자모의 높이를 맞추되, 어느 쪽도 반쪽 폭(half)을 넘지 않게 줄입니다.
 const h=Math.min(.8,...[a,b].map(t=>half/t.nw*t.nh));
 [a,b].forEach((t,k)=>{
  const s=Math.min(half/t.nw,h/t.nh),w=t.nw*s,th=t.nh*s,cx=k?.735:.265,x0=cx-w/2,y0=.5-th/2,src=t.r,reg=t.region;
  for(let y=Math.max(0,Math.floor(y0*H));y<Math.min(H,Math.ceil((y0+th)*H));y++){const v=((y+.5)/H-y0)/th;if(v<0||v>=1)continue;const sy=Math.min(src.height-1,Math.floor((reg.y0+v*t.nh)*src.height));
   for(let x=Math.max(0,Math.floor(x0*W));x<Math.min(W,Math.ceil((x0+w)*W));x++){const u=((x+.5)/W-x0)/w;if(u<0||u>=1)continue;const sx=Math.min(src.width-1,Math.floor((reg.x0+u*t.nw)*src.width));if(src.data[sy*src.width+sx])data[y*W+x]=1}}
 });
 return makeTemplate({char,kind:"jong",width:W,height:H,data,ink:data.reduce((s,v)=>s+v,0)})
}

/** 두 템플릿의 모양이 얼마나 닮았는지(각자 잉크 영역에 맞춘 64×64 격자에서, 조금 어긋나도 봐주는 겹침 F1) */
export function shapeAgreement(a:Template,b:Template):number{
 const Ad=new Uint8Array(G*G),Bd=new Uint8Array(G*G),tmp=new Uint8Array(G*G);dilate(a.bin,2,Ad,tmp);dilate(b.bin,2,Bd,tmp);
 let sa=0,sb=0,pa=0,pb=0;for(let i=0;i<G*G;i++){if(a.bin[i]){sa++;if(Bd[i])pa++}if(b.bin[i]){sb++;if(Ad[i])pb++}}
 if(!sa||!sb)return 0;const p=pa/sa,r=pb/sb;return p+r?2*p*r/(p+r):0
}

function median(v:number[]){const a=[...v].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function medianParam(list:Param[]):Param{return {cx:median(list.map(p=>p.cx)),cy:median(list.map(p=>p.cy)),sx:median(list.map(p=>p.sx)),sy:median(list.map(p=>p.sy))}}

export type Learned={layouts:Map<string,Layout>;weak:string[];scores:Map<string,number>};

/** 직접 쓴 조합 글자들로부터 분류별 자모 배치(위치·크기)를 학습합니다. */
export async function learnLayouts(samples:GlyphRaster[],T:Templates,onProgress?:(n:number)=>void):Promise<Learned>{
 const groups=new Map<string,{cho:Param[];jung:Param[];jong:Param[];count:number}>(),weak:string[]=[],scores=new Map<string,number>();
 for(let i=0;i<samples.length;i++){
  const r=samples[i],parts=decompose(r.char);
  if(parts){
   const f=fit(r,parts,T),k=layoutClass(parts),g=groups.get(k)??{cho:[],jung:[],jong:[],count:0};
   groups.set(k,g);g.count++;scores.set(r.char,f.score);if(f.score<.5)weak.push(r.char);
   slotsOf(parts).forEach(([slot],n)=>g[slot].push(f.params[n]))
  }
  onProgress?.(Math.round((i+1)/samples.length*100));await new Promise(res=>setTimeout(res))
 }
 const layouts=new Map<string,Layout>();
 for(const [k,g] of groups)layouts.set(k,{cho:medianParam(g.cho),jung:medianParam(g.jung),jong:g.jong.length?medianParam(g.jong):null,count:g.count});
 return {layouts,weak,scores}
}

/** 글자 하나를 이루는 자모들의 배치. 학습된 값이 없는 분류는 기본 배치를 씁니다. */
export function place(parts:Parts,layouts:Map<string,Layout>,T:Templates):Placed[]{
 const s=structure(parts),lay=layouts.get(layoutClass(parts));
 return slotsOf(parts).map(([slot,idx])=>{const t=T[slot].get(idx)!,p=(lay&&lay[slot])||paramOf(priorBox(s,slot),t);return {slot,idx,t,p,box:boxOf(p,t)}})
}
export {union};
