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
  amber: '#E08A00',
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
    onSecondaryContainer: C.ink,
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
  const now = new Date();
  if (sameDay(d, now)) return 'Dziś';
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Wczoraj';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
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

// ---- signal "water level" ----------------------------------------------------

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

// water level (1 = full ... 0 = empty) -> green, then orange, then red as it drains
const DRAIN_STOPS = [[0, C.alert], [0.12, C.alert], [0.32, C.amber], [0.58, C.safe], [1, C.safe]];
export function drainColor(level) {
  for (let i = 1; i < DRAIN_STOPS.length; i++) {
    const [l1, c1] = DRAIN_STOPS[i];
    const [l0, c0] = DRAIN_STOPS[i - 1];
    if (level <= l1) return mix(c0, c1, (level - l0) / (l1 - l0));
  }
  return C.safe;
}

const LATE_GRACE_S = 15; // the poll can lag behind a ping that just arrived

/**
 * Countdown to the next expected health ping, or null when there is nothing to count
 * (never seen / offline). level: 1 right after a ping, drains to 0 at the expected time.
 */
export function signalState(hive, now) {
  if (!hive.last_seen || !hive.online) return null;
  const interval = hive.heartbeat_interval || 300;
  const remaining = interval - (now - Date.parse(hive.last_seen)) / 1000;
  const level = Math.min(1, Math.max(0, remaining / interval));
  const late = remaining < -LATE_GRACE_S;
  return { interval, remaining, level, late, lateBy: Math.max(0, -remaining), color: late ? C.alert : drainColor(level) };
}

export const fmtMS = (sec) => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
};
