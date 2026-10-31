import type { Metadata, Viewport } from 'next';
import { Inter, Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import { Shell } from '@/components/shell/shell';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Sampledge AI Research OS', template: '%s · Sampledge AI Research OS' },
  description: 'Your entire research ecosystem. One intelligent command center. (Phase 2 prototype, demo data)',
};
export const viewport: Viewport = { themeColor: '#080D1F', colorScheme: 'dark light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${manrope.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-blue focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
