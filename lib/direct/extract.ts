import {COMMERCIAL_2350} from "./hangul";
import {cellParts,LAYOUT} from "./layout";
import {adaptiveMask,closeGaps,coarsestImagePitch,gaussBlur,removeSpecks} from "../jamo/extract";

export type GlyphRaster={char:string;width:number;height:number;data:Uint8Array;ink:number};

const SIZE=384;

export async function extractPdf(file:ArrayBuffer,onProgress:(n:number)=>void){
 const pdfjs=await import("pdfjs-dist/build/pdf.mjs");
 pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
 const pdf=await pdfjs.getDocument({data:file}).promise,expected=COMMERCIAL_2350,l=LAYOUT,out:GlyphRaster[]=[];
 const needPages=Math.ceil(expected.length/l.perPage);
 if(pdf.numPages!==needPages)throw new Error(`2,350자 가이드는 ${needPages}쪽이어야 합니다. 현재 PDF는 ${pdf.numPages}쪽입니다.`);
 for(let p=1;p<=needPages;p++){
  // 글자 영역(약 17mm)이 384px보다 크게 렌더링되도록 합니다. 작게 렌더링한 뒤 키우면 계단 모양이 그대로 윤곽에 남습니다.
  const page=await pdf.getPage(p),vp=page.getViewport({scale:6}),canvas=document.createElement("canvas");
  canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  // 손글씨가 저해상도 이미지로 들어 있는 PDF(태블릿 앱에서 내보낸 PDF 등)는 원본 픽셀 한 칸의 60%만큼 흐려 계단을 없앱니다(자모 모드와 같은 방식).
  const pitchPt=await coarsestImagePitch(pdfjs,page),first=cellParts(0).writing,writingPt=Math.max(first.w,first.h)*.93*72/25.4,blurSigma=Math.min(4,.6*pitchPt*SIZE/writingPt);
  for(let k=0;k<l.perPage;k++){
   const idx=(p-1)*l.perPage+k;if(idx>=expected.length)break;
   const writing=cellParts(k).writing,sx=vp.width/210,sy=vp.height/297,insetX=writing.w*.035,insetY=writing.h*.035;
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
   const ink=data.reduce((a,v)=>a+v,0);out.push({char:expected[idx],width:tw,height:th,data,ink});
  }
  onProgress(Math.round(p/needPages*100));await new Promise(requestAnimationFrame);
 }
 return out;
}
