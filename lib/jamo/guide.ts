import {PDFDocument} from "pdf-lib";
import {GUIDE_CELLS,KIND_LABEL,KIND_TINT,cellRanges} from "./cells";
import {cellParts,LAYOUT} from "./layout";

const MM_W=210,MM_H=297,SCALE=5.9,FONT='"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
function blobBytes(canvas:HTMLCanvasElement){return new Promise<Uint8Array>((resolve,reject)=>canvas.toBlob(async b=>b?resolve(new Uint8Array(await b.arrayBuffer())):reject(new Error("가이드 이미지를 만들지 못했습니다.")),"image/jpeg",.92))}

export async function makeGuide(onProgress?:(n:number)=>void){
 const doc=await PDFDocument.create(),pages=Math.ceil(GUIDE_CELLS.length/LAYOUT.perPage),canvas=document.createElement("canvas");
 canvas.width=Math.round(MM_W*SCALE);canvas.height=Math.round(MM_H*SCALE);
 const ctx=canvas.getContext("2d")!,mm=(v:number)=>v*SCALE,legend=cellRanges().map(r=>`${KIND_LABEL[r.kind]} ${r.from}-${r.to}`).join("  ·  ");
 doc.setTitle("글씨담 자모 조합 손글씨 가이드");doc.setSubject(`GEULSSIDAM:JAMO:${GUIDE_CELLS.length}:v1`);doc.setCreator("글씨담");
 for(let p=0;p<pages;p++){
  ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.textBaseline="middle";
  ctx.textAlign="left";ctx.fillStyle="#182019";ctx.font=`700 ${mm(4.5)}px ${FONT}`;ctx.fillText("글씨담 · 자모 조합 손글씨 가이드",mm(12),mm(9.5));
  ctx.textAlign="right";ctx.fillStyle="#526056";ctx.font=`500 ${mm(2.8)}px ${FONT}`;ctx.fillText(`${p+1} / ${pages}`,mm(198),mm(9.5));
  ctx.textAlign="left";ctx.font=`400 ${mm(2.5)}px ${FONT}`;ctx.fillText("안쪽 글자 영역의 70-85%를 채워 자연스럽게 써 주세요. 조합 글자는 평소 글씨처럼 쓰세요.",mm(12),mm(15.5));
  ctx.fillStyle="#768078";ctx.font=`400 ${mm(2.3)}px ${FONT}`;ctx.fillText(`${legend}  ·  페이지 순서를 유지해 주세요`,mm(12),mm(20.3));
  ctx.fillStyle="#111";for(const [mx,my] of [[8,22],[199,22],[8,284],[199,284]])ctx.fillRect(mm(mx),mm(my),mm(3),mm(3));
  for(let k=0;k<LAYOUT.perPage;k++){
   const idx=p*LAYOUT.perPage+k,{cell:b,dividerY,writing}=cellParts(k),item=GUIDE_CELLS[idx];
   if(item){ctx.fillStyle=KIND_TINT[item.kind];ctx.fillRect(mm(b.x),mm(b.y),mm(b.w),mm(dividerY-b.y))}
   ctx.strokeStyle="#cbd0ca";ctx.lineWidth=Math.max(1,mm(.12));ctx.strokeRect(mm(b.x),mm(b.y),mm(b.w),mm(b.h));
   ctx.strokeStyle="#d6dad5";ctx.beginPath();ctx.moveTo(mm(b.x+1),mm(dividerY));ctx.lineTo(mm(b.x+b.w-1),mm(dividerY));ctx.stroke();
   ctx.strokeStyle="#dfe3de";ctx.lineWidth=Math.max(1,mm(.10));ctx.strokeRect(mm(writing.x),mm(writing.y),mm(writing.w),mm(writing.h));
   if(!item)continue;
   const cy=b.y+(dividerY-b.y)/2;
   ctx.fillStyle="#899089";ctx.textAlign="left";ctx.font=`600 ${mm(2.35)}px ${FONT}`;ctx.fillText(String(idx+1),mm(b.x+1.2),mm(cy));
   ctx.fillStyle="#8a938c";ctx.textAlign="center";ctx.font=`500 ${mm(2.2)}px ${FONT}`;ctx.fillText(KIND_LABEL[item.kind],mm(b.x+b.w*.5),mm(cy));
   ctx.fillStyle="#3f483f";ctx.textAlign="right";ctx.font=`700 ${mm(3.8)}px ${FONT}`;ctx.fillText(item.char,mm(b.x+b.w-1.4),mm(cy))
  }
  const jpg=await doc.embedJpg(await blobBytes(canvas)),page=doc.addPage([595.28,841.89]);page.drawImage(jpg,{x:0,y:0,width:595.28,height:841.89});
  onProgress?.(Math.round((p+1)/pages*100));await new Promise(requestAnimationFrame)
 }
 return doc.save()
}
export function saveBytes(bytes:Uint8Array,name:string,type="application/pdf"){const blob=new Blob([bytes as BlobPart],{type}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
