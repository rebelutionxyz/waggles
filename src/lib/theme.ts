import { useColorScheme } from 'react-native';

/**
 * Minimal token set. Waggles wears the HONEYCOMB black-and-gold posture: honey
 * accent, calm neutrals, full light/dark support.
 */
export interface Theme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentInk: string;
  danger: string;
  bubbleMine: string;
  bubbleMineInk: string;
  bubbleTheirs: string;
  bubbleTheirsInk: string;
  isDark: boolean;
}

const light: Theme = {
  bg: '#faf8f2',
  surface: '#ffffff',
  surfaceAlt: '#f2efe6',
  border: '#e6e1d4',
  text: '#1a1712',
  textDim: '#7a7261',
  accent: '#e8a317',
  accentInk: '#1a1712',
  danger: '#c0392b',
  bubbleMine: '#e8a317',
  bubbleMineInk: '#1a1712',
  bubbleTheirs: '#ffffff',
  bubbleTheirsInk: '#1a1712',
  isDark: false,
};

const dark: Theme = {
  bg: '#0e0d0a',
  surface: '#1a1712',
  surfaceAlt: '#241f18',
  border: '#332d22',
  text: '#f5f1e6',
  textDim: '#9a9080',
  accent: '#e8a317',
  accentInk: '#1a1712',
  danger: '#e06055',
  bubbleMine: '#e8a317',
  bubbleMineInk: '#1a1712',
  bubbleTheirs: '#241f18',
  bubbleTheirsInk: '#f5f1e6',
  isDark: true,
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}
