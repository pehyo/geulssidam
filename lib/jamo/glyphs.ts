import opentype from "opentype.js";
import type {GlyphRaster} from "./extract";
import {emitContour,inkRegion,normalizedTarget,prepContour,type Prepared,type Pt,type Region} from "./raster";

/** 래스터 잉크의 실효 획 두께(픽셀 단위): 2·면적/둘레 */
export function rawStroke(r:GlyphRaster){
 let area=0,perimeter=0;
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)if(r.data[y*r.width+x]){area++;if(x===0||!r.data[y*r.width+x-1])perimeter++;if(x===r.width-1||!r.data[y*r.width+x+1])perimeter++;if(y===0||!r.data[(y-1)*r.width+x])perimeter++;if(y===r.height-1||!r.data[(y+1)*r.width+x])perimeter++}
 return perimeter?2*area/perimeter:0
}
/** 잉크 바운딩 박스를 880유닛으로 정규화했을 때의 획 두께(폰트 유닛) */
export function effectiveStroke(r:GlyphRaster){
 const g=inkRegion(r,0),boxPx=Math.max((g.x1-g.x0)*r.width,(g.y1-g.y0)*r.height);
 return boxPx?rawStroke(r)*880/boxPx:0
}
/** 목표 두께(effectiveStroke 기준)가 되려면 윤곽을 바깥으로 몇 px 옮겨야 하는지. 음수면 안쪽으로 줄입니다. 원래 획의 30% 넘게는 깎지 않습니다. */
export function strokeOffset(r:GlyphRaster,target:number){
 const g=inkRegion(r,0),boxPx=Math.max((g.x1-g.x0)*r.width,(g.y1-g.y0)*r.height),raw=rawStroke(r);
 if(!boxPx||!raw||!target)return 0;
 return Math.max(-raw*.3,Math.min(12,(target*boxPx/880-raw)/2))
}
/** 획 두께 기준값: 직접 쓴 조합 글자들의 실효 획 두께 중앙값 */
export function strokeTarget(rs:GlyphRaster[]){
 const metrics=rs.map(effectiveStroke).filter(v=>v>0).sort((a,b)=>a-b);
 return metrics[Math.floor(metrics.length/2)]||0
}

function bounds(r:GlyphRaster,region:Region){return {x0:Math.round(region.x0*r.width),x1:Math.round(region.x1*r.width),y0:Math.round(region.y0*r.height),y1:Math.round(region.y1*r.height)}}

/** 1차원 제곱 거리 변환(Felzenszwalb–Huttenlocher) */
function edt1(f:Float64Array,n:number,d:Float64Array,v:Int32Array,z:Float64Array){
 let k=0;v[0]=0;z[0]=-1e20;z[1]=1e20;
 for(let q=1;q<n;q++){let s=(f[q]+q*q-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);while(s<=z[k]){k--;s=(f[q]+q*q-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k])}k++;v[k]=q;z[k]=s;z[k+1]=1e20}
 k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]]}
}
/** 각 픽셀에서 on(i)가 참인 가장 가까운 픽셀까지의 제곱 거리 */
function edt(w:number,h:number,on:(i:number)=>boolean){
 const out=new Float64Array(w*h),n=Math.max(w,h),f=new Float64Array(n),d=new Float64Array(n),v=new Int32Array(n),z=new Float64Array(n+1);
 for(let i=0;i<w*h;i++)out[i]=on(i)?0:1e20;
 for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=out[y*w+x];edt1(f,h,d,v,z);for(let y=0;y<h;y++)out[y*w+x]=d[y]}
 for(let y=0;y<h;y++){for(let x=0;x<w;x++)f[x]=out[y*w+x];edt1(f,w,d,v,z);for(let x=0;x<w;x++)out[y*w+x]=d[x]}
 return out
}
function blur(src:Float64Array,w:number,h:number,sigma:number){
 const R=Math.ceil(sigma*3),k:number[]=[];let t=0;for(let i=-R;i<=R;i++){const v=Math.exp(-i*i/(2*sigma*sigma));k.push(v);t+=v}for(let i=0;i<k.length;i++)k[i]/=t;
 const tmp=new Float64Array(w*h),out=new Float64Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-R;i<=R;i++)s+=src[y*w+Math.min(w-1,Math.max(0,x+i))]*k[i+R];tmp[y*w+x]=s}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-R;i<=R;i++)s+=tmp[Math.min(h-1,Math.max(0,y+i))*w+x]*k[i+R];out[y*w+x]=s}
 return out
}

/** 부호 있는 거리장(잉크 안쪽 음수, 바깥 양수, 픽셀 경계가 0)을 흐려 둔 것. 윤곽 두께를 바꿔 여러 번 추적할 때 재사용합니다. */
export type Field={ox:number;oy:number;w:number;h:number;f:Float64Array};
// 손떨림·스캔 잡음으로 생긴 2~3px 요철을 없애는 정도. 거리장은 획 가장자리에서 선형이라 흐려도 획 두께는 거의 변하지 않고, 모서리와 획 끝만 둥글어집니다.
const SIGMA=2.2;
export function makeField(r:GlyphRaster,region:Region,maxOffset=0):Field{
 const b=bounds(r,region),M=Math.ceil(Math.max(0,maxOffset)+SIGMA*3)+2,ox=b.x0-M,oy=b.y0-M,w=b.x1-b.x0+2*M,h=b.y1-b.y0+2*M;
 const ink=new Uint8Array(w*h);
 for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++)if(r.data[y*r.width+x])ink[(y-oy)*w+(x-ox)]=1;
 const toInk=edt(w,h,i=>ink[i]===1),toBg=edt(w,h,i=>ink[i]===0),sd=new Float64Array(w*h);
 for(let i=0;i<w*h;i++)sd[i]=ink[i]?.5-Math.sqrt(toBg[i]):Math.sqrt(toInk[i])-.5;
 return {ox,oy,w,h,f:blur(sd,w,h,SIGMA)}
}

/**
 * 거리장의 등고선(값 = offset)을 마칭 스퀘어로 부분 픽셀 정밀도로 추적합니다. offset>0이면 획이 두꺼워지고 <0이면 얇아집니다.
 * 잉크가 진행 방향 오른쪽(y 아래 방향 좌표)에 오도록 방향을 맞춰, 바깥 윤곽과 구멍이 서로 반대 방향이 됩니다.
 */
export function contoursAt(F:Field,offset:number):Prepared[]{
 const {ox,oy,w,h,f}=F,L=offset,pos=new Map<number,Pt>(),next=new Map<number,number>();
 // 변 번호: 가로변(x,y)-(x+1,y)=2i, 세로변(x,y)-(x,y+1)=2i+1 (i=y*w+x). 격자점은 픽셀 중심(+.5)입니다.
 // 변 위의 교차점은 이웃한 두 셀이 공유하므로, 보간은 항상 변의 왼쪽/위쪽 끝에서 잽니다.
 const point=(id:number):number=>{if(!pos.has(id)){const i=id>>1,x=i%w,y=(i-x)/w,va=f[i],vb=f[id&1?i+w:i+1],t=va===vb?.5:(L-va)/(vb-va);pos.set(id,id&1?[ox+x+.5,oy+y+.5+t]:[ox+x+.5+t,oy+y+.5])}return id};
 for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
  const tl=y*w+x,tr=tl+1,br=tl+w+1,bl=tl+w,c=[tl,tr,br,bl],inside=c.map(i=>f[i]<L);
  if(inside.every(v=>v)||inside.every(v=>!v))continue;
  // 셀 둘레를 시계 방향(위→오른쪽→아래→왼쪽)으로 돌며 잉크 안팎이 바뀌는 변을 모읍니다.
  const edges=[point(2*tl),point(2*tr+1),point(2*bl),point(2*tl+1)],cross:number[]=[];
  for(let e=0;e<4;e++)if(inside[e]!==inside[(e+1)%4])cross.push(e);
  // 선분은 안→밖으로 바뀌는 변에서 시작해 밖→안으로 바뀌는 변에서 끝납니다.
  if(cross.length===2){const [a,b]=inside[cross[0]]?cross:[cross[1],cross[0]];next.set(edges[a],edges[b])}
  else{
   // 안장점: 셀 중심값으로 대각선 두 잉크가 이어졌는지 판단합니다.
   const center=(f[tl]+f[tr]+f[br]+f[bl])/4<L,starts=cross.filter(e=>inside[e]);
   for(const s of starts){const i=cross.indexOf(s),j=center?(i+1)%4:(i+3)%4;next.set(edges[s],edges[cross[j]])}
  }
 }
 const out:Prepared[]=[],used=new Set<number>();
 for(const start of next.keys()){
  if(used.has(start))continue;
  const raw:Pt[]=[];let id:number|undefined=start;
  while(id!==undefined&&!used.has(id)){used.add(id);raw.push(pos.get(id)!);id=next.get(id)}
  const pc=prepContour(raw,.3,.8);if(pc)out.push(pc)
 }
 return out
}

/** 윤곽을 추적합니다. (배치와 무관하므로 캐시할 수 있습니다.) */
export function traceContours(r:GlyphRaster,region:Region,offset=0):Prepared[]{return contoursAt(makeField(r,region,offset),offset)}

/** 추적된 윤곽을 region → target(글자 칸 대비 0~1 좌표) 변환으로 path에 추가합니다. region 밖으로 두꺼워진 부분도 같은 비율로 따라갑니다. */
export function emitContours(path:opentype.Path,contours:Prepared[],r:GlyphRaster,region:Region,target:Region){
 const {x0,x1,y0,y1}=bounds(r,region);
 const map=([x,y]:Pt):Pt=>{const nx=(x-x0)/(x1-x0),ny=(y-y0)/(y1-y0);return [(target.x0+nx*(target.x1-target.x0))*1000,50+(1-(target.y0+ny*(target.y1-target.y0)))*800]};
 for(const pc of contours)emitContour(path,pc,map)
}

/** 직접 쓴 글자: 잉크 영역을 비율 유지로 정규화하고, 획 두께를 기준값에 맞춰 윤곽을 만듭니다. */
export function directPath(r:GlyphRaster,target:number){
 const region=inkRegion(r,0),p=new opentype.Path();
 emitContours(p,traceContours(r,region,strokeOffset(r,target)),r,region,normalizedTarget(region,r));
 return p
}

const JAMO_BOX=.72;
/** 홀로 쓰는 자모(ㄱ, ㅏ 등): 조합 글자(.88 박스)보다 작은 박스 가운데에 두고, 획 두께는 조합 글자와 같게 맞춥니다. */
export function jamoPath(r:GlyphRaster,target:number){
 const region=inkRegion(r,0),t=normalizedTarget(region,r),k=JAMO_BOX/.88,p=new opentype.Path();
 emitContours(p,traceContours(r,region,strokeOffset(r,target*.88/JAMO_BOX)),r,region,{x0:.5+(t.x0-.5)*k,y0:.5+(t.y0-.5)*k,x1:.5+(t.x1-.5)*k,y1:.5+(t.y1-.5)*k});
 return p
}
