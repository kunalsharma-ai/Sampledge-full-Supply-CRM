/** JS mirror of the CSS design tokens in globals.css. Used by ECharts and Three.js. */
export const palette = {
  midnight: '#080D1F',
  deepSpace: '#101936',
  blue: '#246BFD',
  purple: '#713BFF',
  cyan: '#18D7F2',
  emerald: '#13C996',
  orange: '#FF914D',
  magenta: '#DA4EFF',
  danger: '#FF5C7A',
  warn: '#FFC44D',
} as const;

/** Ordered categorical series. Blue → cyan → purple first: the signature trio. */
export const series = [palette.blue, palette.cyan, palette.purple, palette.emerald, palette.orange, palette.magenta];

export const themeInk = {
  dark: { ink: '#ECF1FF', ink2: '#A8B4D6', ink3: '#707EA8', line: 'rgba(255,255,255,0.08)', surface: '#111A38' },
  light: { ink: '#0C142E', ink2: '#425078', ink3: '#6C789C', line: 'rgba(16,25,54,0.1)', surface: '#FFFFFF' },
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const typeScale = {
  display: { size: 44, weight: 700, family: 'Manrope', tracking: -0.02 },
  h1: { size: 30, weight: 700, family: 'Manrope', tracking: -0.015 },
  h2: { size: 20, weight: 650, family: 'Manrope', tracking: -0.01 },
  h3: { size: 15, weight: 600, family: 'Inter', tracking: 0 },
  body: { size: 14, weight: 400, family: 'Inter', tracking: 0 },
  small: { size: 12.5, weight: 500, family: 'Inter', tracking: 0 },
  eyebrow: { size: 11, weight: 600, family: 'Inter', tracking: 0.14 },
  metric: { size: 26, weight: 700, family: 'Plus Jakarta Sans', tracking: -0.02 },
} as const;
export const motion = {
  fast: 0.15,
  base: 0.28,
  slow: 0.6,
  cinematic: 1.4,
  ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
} as const;
