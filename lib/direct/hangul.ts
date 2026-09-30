const eucKr=new TextDecoder("euc-kr");
export const COMMERCIAL_2350=Array.from({length:25*94},(_,i)=>eucKr.decode(Uint8Array.of(0xb0+Math.floor(i/94),0xa1+i%94)));
