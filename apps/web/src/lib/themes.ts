/**
 * Audience Orbit X theme registry. CSS variables in app/globals.css are the source of truth for
 * colours; this file names the themes, says whether each is dark or light (charts and 3D need it),
 * and carries swatches for the Theme Studio preview.
 */
export type ThemeId = 'cosmic' | 'midnight' | 'contrast' | 'enterprise' | 'emerald' | 'warm';
export type ThemePref = ThemeId | 'system';
export type Density = 'compact' | 'default' | 'comfortable';
export type TextSize = 'sm' | 'md' | 'lg';

export type ThemeDef = {
  id: ThemeId;
  name: string;
  mode: 'dark' | 'light';
  tagline: string;
  bestFor: string;
  /** bg, surface, ink, primary, primary-2, live — for previews only */
  swatch: [string, string, string, string, string, string];
};

export const themes: ThemeDef[] = [
  { id: 'cosmic', name: 'Cosmic Intelligence', mode: 'dark', tagline: 'Deep space, orbit blue and AI violet.', bestFor: 'Default. Command views, presentations, executive reviews.', swatch: ['#070B1C', '#0F1732', '#ECF1FF', '#4D86FF', '#8056FF', '#22D6F0'] },
  { id: 'midnight', name: 'Midnight Blue', mode: 'dark', tagline: 'Cosmic layout with the glow turned down.', bestFor: 'Long operational sessions in a dark room.', swatch: ['#0A1220', '#121E32', '#E2EAF5', '#629CFF', '#56CAE6', '#56CAE6'] },
  { id: 'enterprise', name: 'Bright Enterprise', mode: 'light', tagline: 'Crisp white surfaces, confident blue.', bestFor: 'Daytime work, dense tables, screen sharing.', swatch: ['#F4F6FC', '#FFFFFF', '#0C142E', '#1C5CE6', '#6230E6', '#0686A4'] },
  { id: 'emerald', name: 'Emerald', mode: 'light', tagline: 'Calm greens with a teal accent.', bestFor: 'Rewards, finance and approval work.', swatch: ['#F1F7F4', '#FFFFFF', '#082018', '#087858', '#067A8C', '#067A8C'] },
  { id: 'warm', name: 'Warm Neutral', mode: 'light', tagline: 'Paper tones and terracotta.', bestFor: 'Reading-heavy work: support, content, newsletters.', swatch: ['#F7F4EF', '#FFFDF9', '#241C14', '#A85424', '#8C4030', '#127486'] },
  { id: 'contrast', name: 'High Contrast', mode: 'dark', tagline: 'AAA text, solid surfaces, yellow focus.', bestFor: 'Low vision, bright glare, accessibility review.', swatch: ['#000000', '#0C0C0C', '#FFFFFF', '#6EB6FF', '#6EB6FF', '#FFE800'] },
];

export const themeById = (id: ThemeId) => themes.find((t) => t.id === id) ?? themes[0];

/** Older saved preferences used 'dark' / 'light'. */
export function normalizeTheme(v: unknown): ThemePref {
  if (v === 'dark') return 'cosmic';
  if (v === 'light') return 'enterprise';
  if (v === 'system' || themes.some((t) => t.id === v)) return v as ThemePref;
  return 'cosmic';
}

/** 'system' follows the OS: Cosmic when dark, Bright Enterprise when light. */
export function resolveTheme(pref: ThemePref, osLight: boolean): ThemeId {
  if (pref === 'system') return osLight ? 'enterprise' : 'cosmic';
  return pref;
}

/** Reads the live token values from <html> (after a theme switch) as CSS colour strings. */
export function readTokens() {
  const cs = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const raw = cs?.getPropertyValue(`--${name}`).trim();
    return raw ? `rgb(${raw.split(/\s+/).join(',')})` : fallback;
  };
  const alpha = Number(cs?.getPropertyValue('--line-alpha').trim() || 0.08);
  const lineRaw = cs?.getPropertyValue('--line').trim().split(/\s+/).join(',') || '255,255,255';
  return {
    bg: v('bg', '#070B1C'),
    surface: v('surface', '#0F1732'),
    surface2: v('surface-2', '#162144'),
    ink: v('ink', '#ECF1FF'),
    ink2: v('ink-2', '#ACB8D8'),
    ink3: v('ink-3', '#7A88B0'),
    line: `rgba(${lineRaw},${alpha})`,
    primary: v('primary', '#4D86FF'),
    series: [1, 2, 3, 4, 5, 6].map((i) => v(`chart-${i}`, '#4D86FF')),
    danger: v('danger', '#FF627E'),
    warn: v('warn', '#FFC754'),
    emerald: v('emerald', '#1ECD9B'),
  };
}
