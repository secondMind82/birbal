import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

// ─── Birbal Premium Design System ────────────────────────────────────────────
// Light theme: warm ivory "paper + glass" with blush/lavender gradients,
// champagne accents and deep charcoal typography.
// Dark theme: cinematic deep ink/navy glass with violet/lavender glow.

export interface BirbalTheme {
  primary: string;
  primaryLight: string;
  sidebarStart: string;
  sidebarEnd: string;
  sidebarSelected: string;
  sidebarText: string;
  sidebarIcon: string;

  background: string;
  surface: string;
  surfaceVariant: string;
  surfaceElevated: string;
  text: string;
  textSecondary: string;
  border: string;
  borderFaint: string;
  danger: string;
  success: string;
  accent: string;
  accentSoft: string;
  accent2: string;
  champagne: string;
  onAccent: string;
  scrim: string;
  gradient: {
    brand: readonly [string, string];
    brandSoft: readonly [string, string];
    ink: readonly [string, string];
  };
}

export const colors: BirbalTheme = {
  primary: '#8B6CE6',
  primaryLight: '#D6C8FF',
  sidebarStart: '#262038',
  sidebarEnd: '#41304F',
  sidebarSelected: 'rgba(139, 108, 230, 0.32)',
  sidebarText: '#FFFFFF',
  sidebarIcon: '#CCC3DC',

  background: '#FAF7F1',
  surface: '#FFFFFF',
  surfaceVariant: '#F4EFE9',
  surfaceElevated: '#FFFDFA',
  text: '#241F2C',
  textSecondary: '#786F85',
  border: '#ECE6F0',
  borderFaint: '#F3EEF6',
  danger: '#E0657A',
  success: '#5FA98C',
  accent: '#7C5CDE',
  accentSoft: '#F1EBFF',
  accent2: '#E29CC8',
  champagne: '#C0A37A',
  onAccent: '#FFFFFF',
  scrim: 'rgba(28, 22, 40, 0.35)',
  gradient: {
    brand: ['#8B6CE6', '#E29CC8'],
    brandSoft: ['#F1EBFF', '#F6E7F3'],
    ink: ['#262038', '#41304F'],
  },
} as const;

export const darkColors: BirbalTheme = {
  primary: '#B79DFF',
  primaryLight: '#6C55C4',
  sidebarStart: '#0B0A12',
  sidebarEnd: '#1D1430',
  sidebarSelected: 'rgba(183, 157, 255, 0.26)',
  sidebarText: '#FFFFFF',
  sidebarIcon: '#9E94B4',

  background: '#0F0D17',
  surface: '#181422',
  surfaceVariant: '#221E30',
  surfaceElevated: '#1D182A',
  text: '#F3F0FA',
  textSecondary: '#A39AB8',
  border: '#2B253A',
  borderFaint: '#221D30',
  danger: '#F2798F',
  success: '#6FCFA6',
  accent: '#B79DFF',
  accentSoft: 'rgba(183, 157, 255, 0.16)',
  accent2: '#F0A8D0',
  champagne: '#E0C08F',
  onAccent: '#FFFFFF',
  scrim: 'rgba(5, 4, 10, 0.6)',
  gradient: {
    brand: ['#7A5BE8', '#E89BC9'],
    brandSoft: ['#221A38', '#2B1B30'],
    ink: ['#0B0A12', '#1D1430'],
  },
} as const;

// Fixed layout scale — existing keys keep their values so nothing shifts.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#1C1530',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#1C1530',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#1C1530',
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
} as const;

export type ThemeColors = typeof colors;

export function useAppTheme(): BirbalTheme {
  return useColorScheme() === 'dark' ? darkColors : colors;
}

export function useAppStyles<T>(factory: (c: BirbalTheme) => T): T {
  const c = useAppTheme();
  return useMemo(() => StyleSheet.create(factory(c) as never) as unknown as T, [c]);
}