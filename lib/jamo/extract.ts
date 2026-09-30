import {GUIDE_CELLS,type CellKind} from "./cells";
import {cellParts,LAYOUT} from "./layout";

export type GlyphRaster={char:string;kind:CellKind;width:number;height:number;data:Uint8Array;ink:number};

const SIZE=384;

export function closeGaps(data:Uint8Array,w:number,h:number){
 const src=data.slice();
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(src[i])continue;const horizontal=src[i-1]&&src[i+1],vertical=src[i-w]&&src[i+w],diagonal=src[i-w-1]&&src[i+w+1]||src[i-w+1]&&src[i+w-1];if(horizontal||vertical||diagonal)data[i]=1}
}

export function removeSpecks(data:Uint8Array,w:number,h:number,minSize:number){
 const seen=new Uint8Array(data.length),dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
 for(let i=0;i<data.length;i++){if(!data[i]||seen[i])continue;const stack=[i],group:number[]=[];seen[i]=1;while(stack.length){const q=stack.pop()!,x=q%w,y=Math.floor(q/w);group.push(q);for(const [dx,dy] of dirs){const nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&data[n]&&!seen[n]){seen[n]=1;stack.push(n)}}}if(group.length<minSize)for(const q of group)data[q]=0}
}

function otsu(gray:Float32Array){const hist=new Uint32Array(256);for(const value of gray)hist[Math.max(0,Math.min(255,Math.round(value)))]++;let totalSum=0;for(let i=0;i<256;i++)totalSum+=i*hist[i];let background=0,backgroundSum=0,best=0,threshold=150;for(let i=0;i<256;i++){background+=hist[i];if(!background)continue;const foreground=gray.length-background;if(!foreground)break;backgroundSum+=i*hist[i];const meanBackground=backgroundSum/background,meanForeground=(totalSum-backgroundSum)/foreground,score=background*foreground*(meanBackground-meanForeground)**2;if(score>best){best=score;threshold=i}}return threshold}

export function adaptiveMask(gray:Float32Array,w:number,h:number){const integral=new Float64Array((w+1)*(h+1));for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+row}}const data=new Uint8Array(gray.length),global=Math.max(105,Math.min(190,otsu(gray))),radius=Math.max(5,Math.round(Math.min(w,h)*.045)),bias=16;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),x1=Math.min(w,x+radius+1),y1=Math.min(h,y+radius+1),area=(x1-x0)*(y1-y0),mean=(integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0])/area,value=gray[y*w+x];if(value<78||value<Math.min(global,mean-bias))data[y*w+x]=1}
 // 굵은 획은 가운데가 주변 평균과 비슷해 지역 기준만으로는 속이 비거나 끊깁니다. 확실한 잉크에 이어진, 전역 기준보다 어두운 픽셀까지 넓힙니다.
 const weak=Math.min(global,165),stack:number[]=[];for(let i=0;i<data.length;i++)if(data[i])stack.push(i);
 while(stack.length){const q=stack.pop()!,x=q%w,y=Math.floor(q/w);for(const n of [x>0?q-1:-1,x<w-1?q+1:-1,y>0?q-w:-1,y<h-1?q+w:-1])if(n>=0&&!data[n]&&gray[n]<weak){data[n]=1;stack.push(n)}}
 return data}

export function gaussBlur(src:Float32Array,w:number,h:number,sigma:number){
 if(sigma<.3)return src;
 const R=Math.ceil(sigma*3),k:number[]=[];let t=0;for(let i=-R;i<=R;i++){const v=Math.exp(-i*i/(2*sigma*sigma));k.push(v);t+=v}for(let i=0;i<k.length;i++)k[i]/=t;
 const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-R;i<=R;i++)s+=src[y*w+Math.min(w-1,Math.max(0,x+i))]*k[i+R];tmp[y*w+x]=s}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-R;i<=R;i++)s+=tmp[Math.min(h-1,Math.max(0,y+i))*w+x]*k[i+R];out[y*w+x]=s}
 return out
}

type PdfJs=typeof import("pdfjs-dist");type PdfPage=Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;
/**
 * 페이지에 들어 있는 이미지 중 가장 거친 것의 픽셀 한 칸 크기(PDF pt). 손글씨가 저해상도 이미지로 들어 있으면(태블릿 앱에서 내보낸 PDF 등)
 * 원본 픽셀이 계단으로 확대되어 윤곽이 울퉁불퉁해지므로, 그만큼 흐려 계단을 없앨 때 씁니다. 이미지가 없으면 0.
 */
export async function coarsestImagePitch(pdfjs:PdfJs,page:PdfPage){
 try{
  const ops=await page.getOperatorList(),O=pdfjs.OPS,stack:number[][]=[];let ctm=[1,0,0,1,0,0],pitch=0;
  const mul=(m:number[],n:number[])=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
  ops.fnArray.forEach((fn,i)=>{const a=ops.argsArray[i];
   if(fn===O.save)stack.push(ctm);else if(fn===O.restore)ctm=stack.pop()??ctm;else if(fn===O.transform)ctm=mul(ctm,a);
   else if(fn===O.paintFormXObjectBegin){if(Array.isArray(a?.[0])&&a[0].length===6)ctm=mul(ctm,a[0])}
   else if(fn===O.paintImageXObject&&a?.[1]>0){const shown=Math.hypot(ctm[0],ctm[1]);pitch=Math.max(pitch,shown/a[1])}
  });
  return pitch
 }catch{return 0}
}

export async function extractPdf(file:ArrayBuffer,onProgress:(n:number)=>void){
 const pdfjs=await import("pdfjs-dist/build/pdf.mjs");
 pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
 const pdf=await pdfjs.getDocument({data:file}).promise,l=LAYOUT,out:GlyphRaster[]=[];
 const needPages=Math.ceil(GUIDE_CELLS.length/l.perPage);
 if(pdf.numPages!==needPages)throw new Error(`자모 조합 가이드는 ${needPages}쪽이어야 합니다. 현재 PDF는 ${pdf.numPages}쪽입니다.`);
 for(let p=1;p<=needPages;p++){
  // 글자 영역(약 25mm)이 384px보다 크게 렌더링되도록 합니다. 작게 렌더링한 뒤 키우면 계단 모양이 그대로 윤곽에 남습니다.
  const page=await pdf.getPage(p),vp=page.getViewport({scale:6}),canvas=document.createElement("canvas");
  canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  // 원본 이미지 픽셀 한 칸이 384px 글자 영역에서 몇 px인지 → 그 60%만큼 흐려 계단을 없앱니다(벡터 손글씨·고해상도 스캔은 거의 흐리지 않음).
  const pitchPt=await coarsestImagePitch(pdfjs,page),writingPt=cellParts(0).writing.w*72/25.4,blurSigma=Math.min(4,.6*pitchPt*SIZE/writingPt);
  for(let k=0;k<l.perPage;k++){
   const idx=(p-1)*l.perPage+k;if(idx>=GUIDE_CELLS.length)break;
   const cell=GUIDE_CELLS[idx],writing=cellParts(k).writing,sx=vp.width/210,sy=vp.height/297,insetX=writing.w*.035,insetY=writing.h*.035;
   const x=Math.floor((writing.x+insetX)*sx),y=Math.floor((writing.y+insetY)*sy),w=Math.max(1,Math.floor((writing.w-insetX*2)*sx)),h=Math.max(1,Math.floor((writing.h-insetY*2)*sy));
   const im=ctx.getImageData(x,y,w,h),size=SIZE,tw=size,th=size,gray=new Float32Array(tw*th);gray.fill(255);
   const fitW=w>=h?size:Math.max(1,Math.round(size*w/h)),fitH=h>=w?size:Math.max(1,Math.round(size*h/w)),offX=Math.floor((size-fitW)/2),offY=Math.floor((size-fitH)/2);
   for(let fy=0;fy<fitH;fy++)for(let fx=0;fx<fitW;fx++){
    const xx=offX+fx,yy=offY+fy,x0=Math.floor(fx*w/fitW),x1=Math.max(x0+1,Math.floor((fx+1)*w/fitW)),y0=Math.floor(fy*h/fitH),y1=Math.max(y0+1,Math.floor((fy+1)*h/fitH));
    let sum=0,count=0;
    for(let oy=y0;oy<y1;oy++)for(let ox=x0;ox<x1;ox++){const q=(oy*w+ox)*4;sum+=im.data[q]*.299+im.data[q+1]*.587+im.data[q+2]*.114;count++}
    gray[yy*tw+xx]=sum/count;
   }
   const data=adaptiveMask(gaussBlur(gray,tw,th,blurSigma),tw,th);
   closeGaps(data,tw,th);removeSpecks(data,tw,th,Math.max(5,Math.round(size*size*.00025)));
   const ink=data.reduce((a,v)=>a+v,0);out.push({char:cell.char,kind:cell.kind,width:tw,height:th,data,ink});
  }
  onProgress(Math.round(p/needPages*100));await new Promise(requestAnimationFrame);
 }
 return out;
}
