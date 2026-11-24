import { MD3LightTheme, configureFonts } from 'react-native-paper';

// Warm honey palette
export const C = {
  honey: '#F2B705',
  honeyDark: '#B88600',
  honeySoft: '#FFF1C7',
  bg: '#FFFAEE',
  surface: '#FFFFFF',
  ink: '#2A2210',
  muted: '#7D7562',
  line: '#EDE4CC',
  safe: '#2E7D4F',
  safeBg: '#E4F2E8',
  alert: '#C62F3E',
  alertBg: '#FCE7EA',
  alertLine: '#F2BEC5',
  off: '#7D7562',
  offBg: '#EFEADB',
};

const f = (fontFamily) => ({ fontFamily, fontWeight: '400' });
const REG = 'Inter_400Regular';
const SEMI = 'Inter_600SemiBold';
const BOLD = 'Inter_700Bold';

export const theme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    primary: C.honeyDark,
    onPrimary: '#FFFFFF',
    primaryContainer: C.honey,
    onPrimaryContainer: C.ink,
    secondaryContainer: C.honeySoft,
    background: C.bg,
    surface: C.surface,
    surfaceVariant: C.offBg,
    onSurface: C.ink,
    onSurfaceVariant: C.muted,
    outline: '#D9CDAA',
    outlineVariant: C.line,
    error: C.alert,
  },
  fonts: configureFonts({
    config: {
      displaySmall: f(BOLD),
      headlineMedium: f(BOLD),
      headlineSmall: f(BOLD),
      titleLarge: f(BOLD),
      titleMedium: f(SEMI),
      titleSmall: f(SEMI),
      labelLarge: f(SEMI),
      labelMedium: f(SEMI),
      labelSmall: f(SEMI),
      bodyLarge: f(REG),
      bodyMedium: f(REG),
      bodySmall: f(REG),
    },
  }),
};

// ---- hive status -----------------------------------------------------------

export const STATUS = {
  alert: { label: 'Wykryto szerszenia', icon: 'alert', fg: C.alert, bg: C.alertBg },
  safe: { label: 'Ul bezpieczny', icon: 'shield-check', fg: C.safe, bg: C.safeBg },
  offline: { label: 'Brak sygnału', icon: 'wifi-off', fg: C.off, bg: C.offBg },
};

export const statusOf = (h) => (h.alert ? 'alert' : h.online ? 'safe' : 'offline');

// ---- formatting ------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.toDateString() === b.toDateString();

export const fmtClock = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtDate = (iso) => {
  const d = new Date(iso);
  return sameDay(d, new Date()) ? 'Dziś' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
};

/** "przed chwilą" / "5 min temu" / "3 godz. temu" / "24.11 14:32" */
export function ago(iso) {
  if (!iso) return null;
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (sec < 60) return 'przed chwilą';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} godz. temu`;
  return `${fmtDate(iso)} ${fmtClock(iso)}`;
}

export const batteryIcon = (pct) =>
  pct == null ? 'battery-unknown' : pct >= 85 ? 'battery' : pct >= 60 ? 'battery-70' : pct >= 35 ? 'battery-50' : pct >= 15 ? 'battery-30' : 'battery-alert';

export const rssiQuality = (rssi) => (rssi == null ? null : rssi >= -80 ? 'Dobry' : rssi >= -100 ? 'Średni' : 'Słaby');
