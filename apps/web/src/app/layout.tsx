import type { Metadata, Viewport } from 'next';
import { Inter, Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import { Shell } from '@/components/shell/shell';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'SUPPLY360', template: '%s · SUPPLY360' },
  description: 'SUPPLY360 respondent supply management, designed with Audience Orbit X. Demo data is labelled as such.',
};
export const viewport: Viewport = { themeColor: '#070B1C', colorScheme: 'dark light' };

const themeBoot = `try{var s=JSON.parse(localStorage.getItem('sampledge-os-demo-v1')||'{}').state||{};var t=s.theme||'cosmic';if(t==='dark')t='cosmic';if(t==='light')t='enterprise';if(t==='system')t=matchMedia('(prefers-color-scheme: light)').matches?'enterprise':'cosmic';var d=document.documentElement;d.dataset.theme=t;if(s.density)d.dataset.density=s.density;if(s.textSize)d.dataset.text=s.textSize;if(s.motion)d.dataset.motion=s.motion;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="cosmic" className={`${inter.variable} ${manrope.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme, density and text size before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-blue focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
