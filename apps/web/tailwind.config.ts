import type { Config } from 'tailwindcss';

const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        'bg-2': c('bg-2'),
        surface: c('surface'),
        'surface-2': c('surface-2'),
        line: c('line'),
        ink: c('ink'),
        'ink-2': c('ink-2'),
        'ink-3': c('ink-3'),
        blue: c('blue'),
        purple: c('purple'),
        cyan: c('cyan'),
        emerald: c('emerald'),
        orange: c('orange'),
        magenta: c('magenta'),
        danger: c('danger'),
        warn: c('warn'),
        // Semantic tokens: change per theme (Audience Orbit X)
        primary: c('primary'),
        'primary-2': c('primary-2'),
        'primary-strong': c('primary-strong'),
        'on-primary': c('on-primary'),
        focus: c('focus'),
        'chart-1': c('chart-1'), 'chart-2': c('chart-2'), 'chart-3': c('chart-3'), 'chart-4': c('chart-4'), 'chart-5': c('chart-5'), 'chart-6': c('chart-6'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-manrope)', 'Manrope', 'var(--font-inter)', 'sans-serif'],
        jakarta: ['var(--font-jakarta)', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { xl2: '1.25rem' },
      height: { row: 'var(--row-h)', nav: 'var(--nav-h)' },
      opacity: { 7: '0.07', 12: '0.12', 35: '0.35' },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        glow: '0 0 0 1px rgb(var(--primary) / 0.3), 0 6px 20px -8px rgb(var(--primary) / 0.4)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        'dash-flow': { to: { strokeDashoffset: '-24' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'overlay-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(4px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        'pop-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0', transform: 'translateY(2px) scale(.98)' } },
        'sheet-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        'sheet-out': { from: { transform: 'none' }, to: { transform: 'translateX(-100%)' } },
      },
      animation: {
        'dash-flow': 'dash-flow 1.2s linear infinite',
        'fade-up': 'fade-up .45s cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'overlay-in': 'overlay-in .18s ease-out both',
        'overlay-out': 'overlay-out .14s ease-in both',
        'pop-in': 'pop-in .18s cubic-bezier(.2,.8,.2,1) both',
        'pop-out': 'pop-out .12s ease-in both',
        'sheet-in': 'sheet-in .24s cubic-bezier(.2,.8,.2,1) both',
        'sheet-out': 'sheet-out .18s ease-in both',
      },
    },
  },
  plugins: [],
} satisfies Config;
