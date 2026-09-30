"use client";
import {useMemo,useState} from "react";
import * as directGuide from "@/lib/direct/guide";
import * as directExtract from "@/lib/direct/extract";
import * as directFont from "@/lib/direct/font";
import {COMMERCIAL_2350} from "@/lib/direct/hangul";
import {LAYOUT as DIRECT_LAYOUT} from "@/lib/direct/layout";
import * as jamoGuide from "@/lib/jamo/guide";
import * as jamoExtract from "@/lib/jamo/extract";
import * as jamoFont from "@/lib/jamo/font";
import {GUIDE_CELLS,KIND_LABEL,cellRanges} from "@/lib/jamo/cells";
import {LAYOUT as JAMO_LAYOUT} from "@/lib/jamo/layout";

type Mode="jamo"|"direct";
const JAMO_PAGES=Math.ceil(GUIDE_CELLS.length/JAMO_LAYOUT.perPage),DIRECT_PAGES=Math.ceil(COMMERCIAL_2350.length/DIRECT_LAYOUT.perPage);
const MODES:Array<{id:Mode;count:string;title:string;desc:string}>=[
 {id:"jamo",count:`${GUIDE_CELLS.length}칸`,title:"자모 조합",desc:`자모와 몇 개의 글자만 쓰면 배치를 학습해 한글 11,172자 전체를 조합 (A4 ${JAMO_PAGES}쪽)`},
 {id:"direct",count:"2,350자",title:"직접 글리프",desc:`상용 2,350자를 모두 직접 써서 쓴 모양 그대로 변환 (A4 ${DIRECT_PAGES}쪽)`},
];
const START:Record<Mode,string>={jamo:"가이드부터 내려받아 칸마다 표시된 자모와 글자를 쓰세요.",direct:"가이드부터 내려받아 안쪽 글자 영역에 작성하세요."};
const PREVIEW=["가나다라마바사아자차카타파하","한글 손글씨 폰트 미리보기","옛날 어린이 학교 사랑 행복","갂 똠 뷁 쀍 ㄱ ㄴ ㄹ ㅏ ㅗ ㄺ"];

export default function Home(){
 const [mode,setMode]=useState<Mode>("jamo"),[file,setFile]=useState<File>(),[direct,setDirect]=useState<directExtract.GlyphRaster[]>([]),[jamo,setJamo]=useState<jamoExtract.GlyphRaster[]>([]),[built,setBuilt]=useState<jamoFont.BuiltFont>(),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(START.jamo),[fontName,setFontName]=useState("MyHandwriting");
 const isJamo=mode==="jamo",glyphs=isJamo?jamo:direct,missing=glyphs.filter(g=>g.ink<8),ranges=cellRanges();
 const preview=useMemo(()=>{if(!built)return[];const size=56,opts={kerning:false};return PREVIEW.map(text=>({text,width:Math.ceil(built.font.getAdvanceWidth(text,size,opts))+8,d:built.font.getPath(text,4,size*.8,size,opts).toPathData(1)}))},[built]);
 function pick(m:Mode){if(m===mode)return;setMode(m);setFile(undefined);setDirect([]);setJamo([]);setBuilt(undefined);setProgress(0);setMessage(START[m])}
 async function guide(){setBusy(true);setProgress(0);try{if(isJamo){jamoGuide.saveBytes(await jamoGuide.makeGuide(setProgress),"geulssidam-jamo-guide.pdf");setMessage(`자모 조합 가이드(${GUIDE_CELLS.length}칸, A4 ${JAMO_PAGES}쪽)를 생성했습니다.`)}else{directGuide.saveBytes(await directGuide.makeGuide(setProgress),"geulssidam-safe-area-guide-2350.pdf");setMessage("2,350자 안전영역 가이드를 생성했습니다.")}}catch(e){setMessage(String(e))}finally{setBusy(false);setProgress(0)}}
 async function extract(){if(!file)return;setBusy(true);setProgress(0);setDirect([]);setJamo([]);setBuilt(undefined);try{const data=await file.arrayBuffer();if(isJamo){const rs=await jamoExtract.extractPdf(data,setProgress);setJamo(rs);const blank=rs.filter(r=>r.ink<8);setMessage(blank.length?`${rs.length}칸 추출, 빈 칸 ${blank.length}개 발견: ${blank.map(r=>`${KIND_LABEL[r.kind]} ${r.char}`).slice(0,12).join(", ")}${blank.length>12?" …":""}`:`${rs.length}칸을 모두 추출했습니다.`)}else{const rs=await directExtract.extractPdf(data,setProgress);setDirect(rs);const blank=rs.filter(r=>r.ink<8).length;setMessage(blank?`${rs.length}칸 추출, 빈 칸 ${blank}개 발견`:`${rs.length}칸을 모두 추출했습니다.`)}}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false);setProgress(0)}}
 async function make(){setBusy(true);setProgress(1);setBuilt(undefined);try{const b=await jamoFont.buildFont(jamo,fontName,setProgress);setBuilt(b);const synth=b.synthesized.length?` 겹받침 ${b.synthesized.join(" ")}은 분리가 불안정해 홑받침을 조합한 모양으로 대신했습니다.`:"";setMessage((b.weak.length?`폰트를 만들었습니다. 다만 조합 글자 ${b.weak.join(" ")}의 배치 분석 신뢰도가 낮습니다. 미리보기를 확인하고, 문제가 있으면 해당 칸을 다시 써 보세요.`:"폰트를 만들었습니다. 미리보기를 확인한 뒤 다운로드하세요.")+synth)}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false);setProgress(0)}}
 async function download(){if(isJamo){if(!built)return;try{jamoFont.downloadFont(built.font,fontName);setMessage("TTF 다운로드를 시작했습니다.")}catch(e){setMessage(e instanceof Error?e.message:String(e))}return}setBusy(true);setProgress(1);try{directFont.downloadFont(await directFont.buildFont(direct,fontName,setProgress),fontName);setMessage("TTF 다운로드를 시작했습니다.")}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false);setProgress(0)}}
 return <main>
  <header><div className="mark">글</div><div><p className="eyebrow">LOCAL HANDWRITING STUDIO</p><h1>글씨담</h1><p>내 손글씨를, 온전히 내 컴퓨터 안에서 폰트로.</p></div></header>
  <section className="intro"><span>01</span><div><h2>만들 방식을 고르세요</h2><p>{isJamo?`${ranges.map(r=>`${KIND_LABEL[r.kind]} ${r.to-r.from+1}칸`).join(" · ")} = 총 ${GUIDE_CELLS.length}칸. `:"한글 2,350자 직접 글리프. "}모든 파일 처리는 브라우저에서 이루어지며 서버로 전송되지 않습니다.</p></div></section>
  <div className="modes">{MODES.map(m=><button key={m.id} className={mode===m.id?"active":""} disabled={busy} onClick={()=>pick(m.id)}><b>{m.count}</b><strong>{m.title}</strong><small>{m.desc}</small></button>)}</div>
  <section className="workspace">
   <article><span className="step">02 · GUIDE</span><h2>필기 가이드 받기</h2><p>{isJamo?`초성·중성은 한 칸에 하나씩 쓰고, 받침은 "각"처럼 실제 글자로 자연스럽게 이어 씁니다. 이어서 받침 유무·모음 종류별 조합 글자를 씁니다. A4 ${JAMO_PAGES}쪽입니다.`:`${COMMERCIAL_2350.length.toLocaleString()}개의 칸이 상단 정보영역과 중앙 필기영역으로 분리된 A4 ${DIRECT_PAGES}쪽에 배치됩니다.`}</p><button className="primary" disabled={busy} onClick={guide}>{isJamo?"자모 가이드 PDF":"안전영역 가이드 PDF"}</button></article>
   <article><span className="step">03 · EXTRACT</span><h2>작성 PDF 올리기</h2><label className="drop"><input key={mode} type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0])}/><b>{file?.name||"PDF를 선택하세요"}</b><small>페이지 크기와 순서를 유지해 주세요</small></label><button className="secondary" disabled={!file||busy} onClick={extract}>글자 추출 · 누락 검사</button>{progress>0&&<div className="bar"><i style={{width:`${progress}%`}}/></div>}</article>
   <article><span className="step">04 · FONT</span><h2>TTF 만들기</h2><label className="name">폰트 이름<input value={fontName} onChange={e=>setFontName(e.target.value)}/></label><div className="stat"><b>{glyphs.length}</b><small>추출</small><b className={missing.length?"warn":""}>{missing.length}</b><small>누락</small></div>{isJamo&&<button className="secondary" disabled={!glyphs.length||busy||missing.length>0} onClick={make}>배치 분석 · 폰트 생성</button>}<button className="primary dark" disabled={isJamo?!built||busy:!glyphs.length||busy||missing.length>0} onClick={download}>TTF 다운로드</button></article>
  </section>
  <aside className={message.includes("부족")||message.includes("빈 칸")||message.includes("낮습니다")?"notice warnbox":"notice"}>{busy?`처리 중 ${progress?`· ${progress}%`:""} · 창을 닫지 마세요`:message}</aside>
  {isJamo&&built&&<section className="preview"><h2>미리보기</h2>{preview.map(l=><svg key={l.text} viewBox={`0 0 ${l.width} 68`} width={l.width} height={68} role="img" aria-label={l.text}><path d={l.d} fill="currentColor"/></svg>)}</section>}
  <section className="how"><h2>생성 방식</h2><p>{isJamo?"초성·중성 자모를 단독으로 쓰면 자모 모양이 깨끗하게 확보됩니다. 받침은 단독으로 쓰면 이어 쓸 때와 모양이 달라지기 쉬워 \"각\"처럼 받침이 든 글자를 자연스럽게 쓰게 하고, 이미 확보한 초성·중성 모양을 겹침 정합으로 걷어낸 나머지를 받침 모양으로 분리합니다. 이어서 쓴 조합 글자(세로·가로·복합 모음 × 받침 유무 8종)에서 각 자모가 어느 위치에 얼마나 크게 놓이는지, 여백이 얼마나 남는지를 겹침 정합으로 분석해 분류별 배치 규칙으로 저장합니다. 나머지 글자는 이 규칙으로 자모를 배치하고, 직접 쓴 조합 글자는 원본 그대로 사용합니다.":"칸마다 384×384로 분석한 뒤 2,350자의 중앙 획 두께를 기준으로 가는 글자는 보강하고 굵은 글자는 줄입니다. 저해상도 이미지로 들어 있는 손글씨는 원본 픽셀 크기만큼 흐린 뒤, 거리장 등고선으로 윤곽을 추적해 픽셀 계단을 없앱니다."}</p></section>
  <footer>GEULSSIDAM · SAFE AREA GUIDE · PDF / TTF</footer>
 </main>
}
