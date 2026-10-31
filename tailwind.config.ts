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
      boxShadow: {
        panel: 'var(--shadow-panel)',
        glow: '0 0 0 1px rgb(var(--blue) / 0.35), 0 8px 32px -8px rgb(var(--blue) / 0.45)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        'dash-flow': { to: { strokeDashoffset: '-24' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
      },
      animation: {
        'dash-flow': 'dash-flow 1.2s linear infinite',
        'fade-up': 'fade-up .45s cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
