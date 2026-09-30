import type opentype from "opentype.js";

/**
 * TrueType(glyf) 폰트 파일을 직접 씁니다. opentype.js의 toArrayBuffer()는 필드마다 배열을 이어 붙여 글리프 수에 대해 제곱으로 느려져
 * 11,172자에서 1분 넘게 메인 스레드를 멈추게 합니다(브라우저가 RESULT_CODE_HUNG으로 탭을 종료). 여기서는 타입 배열에 한 번에 씁니다.
 * 3차 곡선은 짧은 구간마다 2차 곡선 하나로 근사하고, 윤곽 방향은 TrueType 규약(바깥 윤곽 시계 방향)에 맞춰 뒤집습니다.
 */

class Bytes{
 buf=new Uint8Array(1<<16);len=0;
 private grow(n:number){if(this.len+n<=this.buf.length)return;let size=this.buf.length*2;while(size<this.len+n)size*=2;const b=new Uint8Array(size);b.set(this.buf.subarray(0,this.len));this.buf=b}
 u8(v:number){this.grow(1);this.buf[this.len++]=v&255}
 u16(v:number){this.grow(2);this.buf[this.len++]=(v>>8)&255;this.buf[this.len++]=v&255}
 i16(v:number){this.u16(v<0?v+65536:v)}
 u32(v:number){this.u16(Math.floor(v/65536)&65535);this.u16(v&65535)}
 bytes(b:Uint8Array){this.grow(b.length);this.buf.set(b,this.len);this.len+=b.length}
 pad4(){while(this.len%4)this.u8(0)}
 out(){return this.buf.slice(0,this.len)}
}

type Pt={x:number;y:number;on:boolean};
type GlyphData={bytes:Uint8Array;xMin:number;yMin:number;xMax:number;yMax:number;points:number;contours:number};

/** opentype.Path 명령을 TrueType 윤곽(정수 좌표, on/off 곡선점)으로 변환 */
function contoursOf(path:opentype.Path):Pt[][]{
 const out:Pt[][]=[];let cur:Pt[]=[],px=0,py=0;
 const close=()=>{
  if(cur.length>1){const a=cur[0],b=cur[cur.length-1];if(b.on&&a.x===b.x&&a.y===b.y)cur.pop()}
  // 방향을 뒤집고, 윤곽이 곡선 위의 점(on)에서 시작하도록 돌려 둡니다.
  if(cur.length>=3){const r=cur.reverse(),s=Math.max(0,r.findIndex(p=>p.on));out.push([...r.slice(s),...r.slice(0,s)])}
  cur=[]
 };
 for(const c of path.commands){
  if(c.type==="M"){close();cur.push({x:Math.round(c.x),y:Math.round(c.y),on:true});px=c.x;py=c.y}
  else if(c.type==="L"){cur.push({x:Math.round(c.x),y:Math.round(c.y),on:true});px=c.x;py=c.y}
  else if(c.type==="Q"){cur.push({x:Math.round(c.x1),y:Math.round(c.y1),on:false},{x:Math.round(c.x),y:Math.round(c.y),on:true});px=c.x;py=c.y}
  else if(c.type==="C"){
   // 짧은 3차 곡선의 2차 근사: 제어점 = (3(c1+c2) − (p0+p3)) / 4
   const qx=(3*(c.x1+c.x2)-(px+c.x))/4,qy=(3*(c.y1+c.y2)-(py+c.y))/4;
   cur.push({x:Math.round(qx),y:Math.round(qy),on:false},{x:Math.round(c.x),y:Math.round(c.y),on:true});px=c.x;py=c.y
  }
  else if(c.type==="Z")close()
 }
 close();
 return out
}

function encodeGlyph(path:opentype.Path):GlyphData{
 const contours=contoursOf(path);
 if(!contours.length)return {bytes:new Uint8Array(0),xMin:0,yMin:0,xMax:0,yMax:0,points:0,contours:0};
 let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity,n=0;
 for(const c of contours)for(const p of c){xMin=Math.min(xMin,p.x);yMin=Math.min(yMin,p.y);xMax=Math.max(xMax,p.x);yMax=Math.max(yMax,p.y);n++}
 const b=new Bytes(),flags:number[]=[],xs=new Bytes(),ys=new Bytes();
 b.i16(contours.length);b.i16(xMin);b.i16(yMin);b.i16(xMax);b.i16(yMax);
 let end=-1;for(const c of contours){end+=c.length;b.u16(end)}
 b.u16(0);// 힌팅 명령 없음
 let lx=0,ly=0;
 for(const c of contours)for(const p of c){
  const dx=p.x-lx,dy=p.y-ly;let f=p.on?1:0;
  if(dx===0)f|=16;else if(Math.abs(dx)<256){f|=2;if(dx>0)f|=16;xs.u8(Math.abs(dx))}else xs.i16(dx);
  if(dy===0)f|=32;else if(Math.abs(dy)<256){f|=4;if(dy>0)f|=32;ys.u8(Math.abs(dy))}else ys.i16(dy);
  flags.push(f);lx=p.x;ly=p.y
 }
 for(const f of flags)b.u8(f);
 b.bytes(xs.out());b.bytes(ys.out());b.pad4();
 return {bytes:b.out(),xMin,yMin,xMax,yMax,points:n,contours:contours.length}
}

function utf16be(s:string){const b=new Bytes();for(let i=0;i<s.length;i++)b.u16(s.charCodeAt(i));return b.out()}
function checksum(t:Uint8Array){let s=0;for(let i=0;i<t.length;i+=4)s=(s+((t[i]<<24)|((t[i+1]??0)<<16)|((t[i+2]??0)<<8)|(t[i+3]??0))>>>0)>>>0;return s}

export function writeTTF(glyphs:opentype.Glyph[],familyName:string,opts={unitsPerEm:1000,ascender:850,descender:-150}):ArrayBuffer{
 const enc=glyphs.map(g=>encodeGlyph(g.path)),adv=glyphs.map(g=>Math.round(g.advanceWidth??0));
 const inked=enc.filter(e=>e.points),X0=Math.min(0,...inked.map(e=>e.xMin)),Y0=Math.min(0,...inked.map(e=>e.yMin)),X1=Math.max(0,...inked.map(e=>e.xMax)),Y1=Math.max(0,...inked.map(e=>e.yMax));
 const tables:Record<string,Uint8Array>={};

 // glyf + loca(long)
 const glyf=new Bytes(),loca=new Bytes();for(const e of enc){loca.u32(glyf.len);glyf.bytes(e.bytes)}loca.u32(glyf.len);
 tables.glyf=glyf.out();tables.loca=loca.out();

 const head=new Bytes(),now=Math.floor(Date.now()/1000)+2082844800;
 head.u32(0x00010000);head.u32(0x00010000);head.u32(0);head.u32(0x5F0F3CF5);head.u16(0x000B);head.u16(opts.unitsPerEm);
 for(let i=0;i<2;i++){head.u32(Math.floor(now/2**32));head.u32(now>>>0)}
 head.i16(X0);head.i16(Y0);head.i16(X1);head.i16(Y1);head.u16(0);head.u16(8);head.i16(2);head.i16(1);head.i16(0);
 tables.head=head.out();

 const lsb=enc.map(e=>e.points?e.xMin:0),rsbMin=Math.min(...enc.map((e,i)=>e.points?adv[i]-e.xMax:0));
 const hhea=new Bytes();hhea.u32(0x00010000);hhea.i16(opts.ascender);hhea.i16(opts.descender);hhea.i16(0);hhea.u16(Math.max(...adv));
 hhea.i16(Math.min(...lsb));hhea.i16(rsbMin);hhea.i16(X1);hhea.i16(1);hhea.i16(0);hhea.i16(0);for(let i=0;i<5;i++)hhea.i16(0);hhea.u16(glyphs.length);
 tables.hhea=hhea.out();

 const hmtx=new Bytes();glyphs.forEach((_,i)=>{hmtx.u16(adv[i]);hmtx.i16(lsb[i])});tables.hmtx=hmtx.out();

 const maxp=new Bytes();maxp.u32(0x00010000);maxp.u16(glyphs.length);maxp.u16(Math.max(...enc.map(e=>e.points)));maxp.u16(Math.max(...enc.map(e=>e.contours)));
 maxp.u16(0);maxp.u16(0);maxp.u16(2);for(let i=0;i<8;i++)maxp.u16(0);
 tables.maxp=maxp.out();

 // cmap: 코드포인트가 연속이고 글리프 번호도 연속인 구간끼리 묶은 format 4 (한글은 모두 BMP)
 const pairs=glyphs.map((g,i)=>[g.unicode??0,i] as [number,number]).filter(([u])=>u>0&&u<0xFFFF).sort((a,b)=>a[0]-b[0]),segs:Array<[number,number,number]>=[];
 for(const [u,g] of pairs){const s=segs[segs.length-1];if(s&&u===s[1]+1&&g-u===s[2])s[1]=u;else segs.push([u,u,g-u])}
 segs.push([0xFFFF,0xFFFF,1]);
 const segX2=segs.length*2,sr=2*2**Math.floor(Math.log2(segs.length)),f4=new Bytes();
 f4.u16(4);f4.u16(16+segs.length*8);f4.u16(0);f4.u16(segX2);f4.u16(sr);f4.u16(Math.log2(sr/2));f4.u16(segX2-sr);
 for(const s of segs)f4.u16(s[1]);f4.u16(0);for(const s of segs)f4.u16(s[0]);for(const s of segs)f4.u16((s[2]+65536)%65536);for(const _ of segs)f4.u16(0);
 const cmap=new Bytes();cmap.u16(0);cmap.u16(1);cmap.u16(3);cmap.u16(1);cmap.u32(12);cmap.bytes(f4.out());tables.cmap=cmap.out();

 const ps=(familyName.replace(/[^A-Za-z0-9-]/g,"")||"MyHandwriting")+"-Regular",names:Array<[number,string]>=[[1,familyName],[2,"Regular"],[3,`${ps};1.000`],[4,`${familyName} Regular`],[5,"Version 1.000"],[6,ps]];
 const name=new Bytes(),strs=new Bytes(),recs:Array<[number,number,number,number]>=[];
 for(const lang of [0x0409,0x0412])for(const [id,s] of names){const b=utf16be(s);recs.push([lang,id,b.length,strs.len]);strs.bytes(b)}
 recs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 name.u16(0);name.u16(recs.length);name.u16(6+recs.length*12);for(const [lang,id,len,off] of recs){name.u16(3);name.u16(1);name.u16(lang);name.u16(id);name.u16(len);name.u16(off)}name.bytes(strs.out());
 tables.name=name.out();

 const us=pairs.map(p=>p[0]),os2=new Bytes(),avg=Math.round(adv.filter(a=>a>0).reduce((a,b)=>a+b,0)/Math.max(1,adv.filter(a=>a>0).length));
 os2.u16(4);os2.i16(avg);os2.u16(400);os2.u16(5);os2.u16(0);
 for(const v of [650,600,0,75,650,600,0,350,50,260])os2.i16(v);os2.i16(0);for(let i=0;i<10;i++)os2.u8(0);
 // 유니코드 범위: 기본 라틴(0), 한글 호환 자모(52), 한글 음절(56)
 os2.u32(1);os2.u32((1<<20)|(1<<24));os2.u32(0);os2.u32(0);for(const c of "NONE")os2.u8(c.charCodeAt(0));
 os2.u16(0x0040);os2.u16(Math.min(...us));os2.u16(Math.max(...us));os2.i16(opts.ascender);os2.i16(opts.descender);os2.i16(0);
 os2.u16(Math.max(opts.ascender,Y1));os2.u16(Math.max(-opts.descender,-Y0));os2.u32(1<<19);os2.u32(0);os2.i16(0);os2.i16(700);os2.u16(0);os2.u16(32);os2.u16(0);
 tables["OS/2"]=os2.out();

 const post=new Bytes();post.u32(0x00030000);post.u32(0);post.i16(-100);post.i16(50);post.u32(0);for(let i=0;i<4;i++)post.u32(0);tables.post=post.out();

 // 테이블 디렉터리(태그 순), 4바이트 정렬, 체크섬, head.checkSumAdjustment
 const tags=Object.keys(tables).sort(),n=tags.length,es=2**Math.floor(Math.log2(n)),file=new Bytes();
 file.u32(0x00010000);file.u16(n);file.u16(es*16);file.u16(Math.log2(es));file.u16(n*16-es*16);
 let off=12+n*16;const headOff:number[]=[];
 for(const t of tags){const d=tables[t];for(let i=0;i<4;i++)file.u8(t.charCodeAt(i));file.u32(checksum(d));if(t==="head")headOff.push(off);file.u32(off);file.u32(d.length);off+=Math.ceil(d.length/4)*4}
 for(const t of tags){file.bytes(tables[t]);file.pad4()}
 const out=file.out(),adj=(0xB1B0AFBA-checksum(out)+2**32)%2**32,h=headOff[0]+8;
 out[h]=adj>>>24;out[h+1]=(adj>>>16)&255;out[h+2]=(adj>>>8)&255;out[h+3]=adj&255;
 return out.buffer
}
