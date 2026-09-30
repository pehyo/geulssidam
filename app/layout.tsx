import "./globals.css";
export const metadata = { title: "글씨담", description: "손글씨를 한글 TTF로 만드는 로컬 도구 (자모 조합 / 2,350자 직접 글리프)" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ko"><body>{children}</body></html>; }
