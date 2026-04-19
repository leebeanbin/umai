import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import ThemeProvider from "@/components/providers/ThemeProvider";
import LanguageProvider from "@/components/providers/LanguageProvider";
import { SidebarProvider } from "@/components/providers/SidebarProvider";
import AuthProvider from "@/components/providers/AuthProvider";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Umai-bin",
  description: "Chat-based AI image editor",
};

// paint 전 테마 클래스를 동기적으로 적용하는 blocking script
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('umai_settings');var t=s?JSON.parse(s).theme:'dark';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 테마 flash 방지: 렌더 전 동기 실행 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${geist.className} bg-base text-text-primary h-full`}>
        <LanguageProvider>
          <ThemeProvider>
            <AuthProvider>
              <SidebarProvider>
                <AppShell>{children}</AppShell>
              </SidebarProvider>
            </AuthProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
