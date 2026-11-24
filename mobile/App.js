import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator, Button, FAB, IconButton, PaperProvider, Surface, Text, TextInput, TouchableRipple,
} from 'react-native-paper';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { api } from './api';
import { C, STATUS, ago, batteryIcon, fmtClock, fmtDate, fmtMS, rssiQuality, signalState, statusOf, theme } from './theme';

const POLL_MS = 5000;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---- small pieces ----------------------------------------------------------

/** Gently pulses its children (used for alarms). */
function Pulse({ children, style }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 700, useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[style, { opacity: v }]}>{children}</Animated.View>;
}

/**
 * Ring around its children that shows the signal: full and green right after a health
 * ping, draining and turning orange, then red until the next one is due. An alarm
 * overrides it with a pulsing red ring.
 */
function SignalRing({ hive, now, size = 56, stroke = 4, alert = false, children }) {
  const sg = signalState(hive, now);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const level = alert ? 1 : sg ? sg.level : 0;
  const color = alert ? C.alert : sg ? sg.color : C.line;
  const ring = (
    <Svg width={size} height={size} style={s.ringSvg}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={sg?.late ? C.alertLine : C.line} strokeWidth={stroke} fill="none" />
      {level > 0.004 && (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - level)}
        />
      )}
    </Svg>
  );
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {alert ? <Pulse style={StyleSheet.absoluteFill}>{ring}</Pulse> : ring}
      {children}
    </View>
  );
}

const countdownText = (sg) => (sg.late ? `+${fmtMS(sg.lateBy)}` : fmtMS(sg.remaining));

function Notice({ icon = 'alert-circle-outline', text, tone = 'alert', onRetry }) {
  const fg = tone === 'alert' ? C.alert : C.muted;
  return (
    <Surface style={[s.notice, { backgroundColor: tone === 'alert' ? C.alertBg : C.offBg }]} elevation={0}>
      <Icon name={icon} size={22} color={fg} />
      <Text variant="bodyMedium" style={{ color: fg, flex: 1 }}>{text}</Text>
      {onRetry && <Button compact onPress={onRetry} textColor={fg}>Ponów</Button>}
    </Surface>
  );
}

function PrimaryButton({ children, loading, disabled, onPress, style }) {
  return (
    <Button
      mode="contained"
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      buttonColor={C.honey}
      textColor={C.ink}
      style={[s.btn, style]}
      contentStyle={s.btnContent}
      labelStyle={s.btnLabel}
    >
      {children}
    </Button>
  );
}

function Input({ label, hint, style, ...props }) {
  return (
    <View style={[{ flex: 1 }, style]}>
      <TextInput
        mode="outlined"
        label={label}
        dense
        outlineColor={C.line}
        activeOutlineColor={C.honeyDark}
        outlineStyle={{ borderRadius: 12 }}
        style={s.input}
        {...props}
      />
      {hint ? <Text variant="bodySmall" style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

function TopBar({ title, subtitle, onBack }) {
  return (
    <View style={s.topBar}>
      <IconButton icon="arrow-left" size={24} iconColor={C.ink} onPress={onBack} style={{ marginLeft: -8 }} />
      <View style={{ flex: 1 }}>
        <Text variant="titleLarge" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="bodySmall" style={s.muted}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

// ---- list screen -----------------------------------------------------------

function Brand() {
  return (
    <View style={s.brand}>
      <View style={s.logo}>
        <Icon name="beehive-outline" size={26} color={C.ink} />
      </View>
      <View>
        <Text variant="headlineSmall">VespaGuard</Text>
        <Text variant="bodySmall" style={s.muted}>Ochrona Twoich uli przed szerszeniami</Text>
      </View>
    </View>
  );
}

/** Alarm takes over the top of the screen. */
function AlertHero({ alerts, onOpen }) {
  const first = alerts[0];
  const names = alerts.map((h) => h.name || h.id).join(', ');
  return (
    <View style={s.alertHero}>
      <View style={s.alertHeroIcon}>
        <Pulse style={s.alertHalo} />
        <Icon name="alert" size={32} color="#fff" />
      </View>
      <Text variant="labelLarge" style={s.alertKicker}>ALARM</Text>
      <Text variant="headlineMedium" style={s.alertTitle}>
        {alerts.length === 1 ? 'Wykryto szerszenia' : `Wykryto szerszenie w ${alerts.length} ulach`}
      </Text>
      <Text variant="bodyLarge" style={s.alertSub}>
        {names}{first.last ? ` · ${ago(first.last)}` : ''}
      </Text>
      <Button
        mode="contained"
        buttonColor="#fff"
        textColor={C.alert}
        style={[s.btn, { marginTop: 18, alignSelf: 'stretch' }]}
        contentStyle={s.btnContent}
        labelStyle={s.btnLabel}
        onPress={() => onOpen(first.id)}
      >
        {alerts.length === 1 ? 'Zobacz ul' : `Zobacz: ${first.name || first.id}`}
      </Button>
    </View>
  );
}

function Summary({ hives }) {
  const offline = hives.filter((h) => !h.online);
  let tone = 'safe';
  let title = 'Wszystkie ule są bezpieczne';
  let sub = `${hives.length} ${hives.length === 1 ? 'ul' : 'uli'} pod ochroną`;
  if (offline.length) {
    tone = 'offline';
    title = offline.length === hives.length ? 'Brak sygnału z uli' : 'Część uli bez sygnału';
    sub = offline.map((h) => h.name || h.id).join(', ');
  }
  const st = STATUS[tone];
  return (
    <View style={[s.summary, { backgroundColor: st.bg }]}>
      <View style={[s.summaryIcon, { backgroundColor: st.fg }]}>
        <Icon name={st.icon} size={22} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="titleMedium" style={{ color: st.fg }}>{title}</Text>
        <Text variant="bodySmall" style={{ color: st.fg, opacity: 0.85 }} numberOfLines={2}>{sub}</Text>
      </View>
    </View>
  );
}

function HiveCard({ hive, now, onPress }) {
  const status = statusOf(hive);
  const st = STATUS[status];
  const isAlert = status === 'alert';
  const sg = signalState(hive, now);
  const seen = ago(hive.last_seen);
  return (
    <Surface style={[s.card, isAlert && s.cardAlert]} elevation={0}>
      <TouchableRipple onPress={onPress} borderless style={s.cardTouch} rippleColor="rgba(0,0,0,0.06)">
        <View style={s.cardRow}>
          <SignalRing hive={hive} now={now} size={56} alert={isAlert}>
            <Icon name={st.icon} size={24} color={st.fg} />
          </SignalRing>
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="titleMedium" numberOfLines={1}>{hive.name || hive.id}</Text>
            <Text variant="labelLarge" style={{ color: st.fg }} numberOfLines={1}>{st.label}</Text>
            <Text variant="bodySmall" style={s.muted} numberOfLines={1}>{hive.id} · {seen ?? 'brak sygnału'}</Text>
          </View>
          {sg && (
            <Text variant="titleMedium" style={[s.countdown, { color: sg.late ? C.alert : sg.color }]}>
              {countdownText(sg)}
            </Text>
          )}
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function Empty({ onAdd }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Icon name="beehive-outline" size={40} color={C.honeyDark} /></View>
      <Text variant="titleLarge" style={{ marginTop: 16 }}>Nie masz jeszcze uli</Text>
      <Text variant="bodyMedium" style={[s.muted, { textAlign: 'center', marginTop: 6 }]}>
        Dodaj pierwszy ul, aby zacząć go monitorować.
      </Text>
      <PrimaryButton onPress={onAdd} style={{ marginTop: 20, alignSelf: 'center' }}>Dodaj ul</PrimaryButton>
    </View>
  );
}

function List({ hives, error, refreshing, onRefresh, onOpen, onAdd }) {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const alerts = (hives || []).filter((h) => h.alert);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.honeyDark} colors={[C.honeyDark]} />}
      >
        <Brand />
        {error && <Notice text={error} onRetry={onRefresh} />}
        {hives === null && !error && <ActivityIndicator color={C.honeyDark} style={{ marginTop: 48 }} />}
        {hives && hives.length > 0 && (
          <>
            {alerts.length > 0 ? <AlertHero alerts={alerts} onOpen={onOpen} /> : <Summary hives={hives} />}
            <Text variant="labelLarge" style={s.sectionLabel}>TWOJE ULE</Text>
            <View style={{ gap: 12 }}>
              {hives.map((h) => <HiveCard key={h.id} hive={h} now={now} onPress={() => onOpen(h.id)} />)}
            </View>
          </>
        )}
        {hives && hives.length === 0 && !error && <Empty onAdd={onAdd} />}
      </ScrollView>
      {hives && hives.length > 0 && (
        <FAB
          icon="plus"
          label="Dodaj ul"
          onPress={onAdd}
          color={C.ink}
          style={[s.fab, { bottom: Math.max(insets.bottom, 12) + 12, backgroundColor: C.honey }]}
        />
      )}
    </View>
  );
}

// ---- add / details ---------------------------------------------------------

function AddHive({ onSave, onCancel }) {
  const [f, setF] = useState({ id: '', lat: '', lng: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const submit = async () => {
    if (!f.id.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try { await onSave(f); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <View style={{ flex: 1 }}>
      <TopBar title="Dodaj nowy ul" onBack={onCancel} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Surface style={s.panel} elevation={0}>
          <Input label="ID ula" placeholder="np. VG-0158" hint="Znajdziesz je na naklejce urządzenia." value={f.id} onChangeText={set('id')} autoCapitalize="characters" />
          <Input label="Nazwa (opcjonalnie)" placeholder="np. Ul przy sadzie" hint="Będzie widoczna na liście uli." value={f.name} onChangeText={set('name')} style={{ marginTop: 16 }} />
          <Text variant="labelLarge" style={[s.sectionLabel, { marginTop: 20 }]}>WSPÓŁRZĘDNE</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Input label="Szerokość" placeholder="50.0647" keyboardType="numeric" value={f.lat} onChangeText={set('lat')} />
            <Input label="Długość" placeholder="19.9450" keyboardType="numeric" value={f.lng} onChangeText={set('lng')} />
          </View>
        </Surface>
        {err && <Notice text={err} />}
        <PrimaryButton onPress={submit} loading={busy} disabled={busy || !f.id.trim()} style={{ marginTop: 20 }}>Dodaj ul</PrimaryButton>
        <Button onPress={onCancel} textColor={C.muted} style={{ marginTop: 4 }} labelStyle={s.btnLabel}>Anuluj</Button>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value, note }) {
  return (
    <View style={s.stat}>
      <Icon name={icon} size={22} color={C.honeyDark} />
      <View>
        <Text variant="titleMedium">{value}</Text>
        <Text variant="bodySmall" style={s.muted}>{note ? `${label} · ${note}` : label}</Text>
      </View>
    </View>
  );
}

function LogRow({ log, last }) {
  const alert = log.alert;
  return (
    <View style={[s.logRow, alert && { backgroundColor: C.alertBg }, !last && s.logDivider]}>
      <View style={[s.logIcon, { backgroundColor: alert ? C.alert : C.safeBg }]}>
        <Icon name={alert ? 'alert' : 'check'} size={16} color={alert ? '#fff' : C.safe} />
      </View>
      <Text variant="bodyMedium" style={{ flex: 1, color: alert ? C.alert : C.ink, fontFamily: alert ? 'Inter_600SemiBold' : 'Inter_400Regular' }}>
        {alert ? 'Wykryto szerszenia' : 'Ul bezpieczny'}
      </Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="labelLarge" style={{ color: alert ? C.alert : C.ink }}>{fmtClock(log.ts)}</Text>
        <Text variant="bodySmall" style={s.muted}>{fmtDate(log.ts)}</Text>
      </View>
    </View>
  );
}

function Details({ hive, onSave, onBack }) {
  const [f, setF] = useState(hive);
  const [logs, setLogs] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  const loadLogs = useCallback(() => {
    api.getLogs(hive.id).then((l) => { setLogs(l); setErr(null); }).catch((e) => setErr(e.message));
  }, [hive.id]);
  useEffect(() => {
    loadLogs();
    const t = setInterval(loadLogs, POLL_MS);
    return () => clearInterval(t);
  }, [loadLogs]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try { await onSave(f); } catch (e) { setErr(e.message); setBusy(false); }
  };

  const now = useNow();
  const status = statusOf(hive);
  const st = STATUS[status];
  const isAlert = status === 'alert';
  const seen = ago(hive.last_seen);
  const sg = signalState(hive, now);

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={hive.name || hive.id} subtitle={`ID: ${hive.id}`} onBack={onBack} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={[s.hero, { backgroundColor: st.bg }, isAlert && { borderColor: C.alertLine, borderWidth: 1 }]}>
          <SignalRing hive={hive} now={now} size={92} stroke={7} alert={isAlert}>
            {sg ? (
              <Text variant="titleLarge" style={[s.heroCountdown, { color: sg.late ? C.alert : C.ink }]}>{countdownText(sg)}</Text>
            ) : (
              <Icon name={st.icon} size={32} color={st.fg} />
            )}
          </SignalRing>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="titleLarge" style={{ color: st.fg }}>{st.label}</Text>
            <Text variant="bodyMedium" style={{ color: C.ink }}>
              {!sg
                ? (seen ? `Ostatni sygnał: ${seen}` : 'Czekamy na pierwszy sygnał')
                : sg.late ? `Spóźniony o ${fmtMS(sg.lateBy)}` : `Healthcheck za ${fmtMS(sg.remaining)}`}
            </Text>
            {sg && <Text variant="bodySmall" style={s.muted}>Ostatni: {seen} · co {Math.round(sg.interval / 60)} min</Text>}
          </View>
        </View>

        <Surface style={s.statsPanel} elevation={0}>
          <Stat icon={batteryIcon(hive.battery)} label="Bateria" value={hive.battery == null ? '—' : `${hive.battery}%`} />
          <View style={s.statDivider} />
          <Stat icon="signal" label="Zasięg" value={hive.rssi == null ? '—' : `${hive.rssi} dBm`} note={rssiQuality(hive.rssi)} />
        </Surface>

        <Text variant="labelLarge" style={s.sectionLabel}>DANE ULA</Text>
        <Surface style={s.panel} elevation={0}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Input label="ID ula" value={f.id} onChangeText={set('id')} autoCapitalize="characters" />
            <Input label="Nazwa" value={f.name} onChangeText={set('name')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <Input label="Szerokość" keyboardType="numeric" value={f.lat} onChangeText={set('lat')} />
            <Input label="Długość" keyboardType="numeric" value={f.lng} onChangeText={set('lng')} />
          </View>
        </Surface>
        <PrimaryButton onPress={submit} loading={busy} disabled={busy} style={{ marginTop: 16 }}>Zapisz zmiany</PrimaryButton>

        <Text variant="labelLarge" style={[s.sectionLabel, { marginTop: 28 }]}>HISTORIA ZDARZEŃ</Text>
        {err && <Notice text={err} />}
        {logs === null && !err && <ActivityIndicator color={C.honeyDark} style={{ marginTop: 12 }} />}
        {logs && logs.length === 0 && <Notice tone="muted" icon="history" text="Brak zdarzeń z tego ula." />}
        {logs && logs.length > 0 && (
          <Surface style={s.logPanel} elevation={0}>
            {logs.map((l, i) => <LogRow key={`${l.ts}-${i}`} log={l} last={i === logs.length - 1} />)}
          </Surface>
        )}
      </ScrollView>
    </View>
  );
}

// ---- root ------------------------------------------------------------------

function Root() {
  const insets = useSafeAreaInsets();
  const [hives, setHives] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [screen, setScreen] = useState({ name: 'list' });

  const load = useCallback(async () => {
    try {
      setHives(await api.listHives());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const home = () => setScreen({ name: 'list' });

  let body;
  if (screen.name === 'add') {
    body = <AddHive onCancel={home} onSave={async (h) => { await api.createHive(h); await load(); home(); }} />;
  } else if (screen.name === 'details') {
    const hive = (hives || []).find((h) => h.id === screen.id);
    body = hive ? (
      <Details
        key={hive.id}
        hive={hive}
        onBack={home}
        onSave={async (u) => { await api.updateHive(hive.id, u); await load(); home(); }}
      />
    ) : (
      <View style={{ flex: 1 }}>
        <TopBar title="VespaGuard" onBack={home} />
        <View style={s.scroll}><Notice tone="muted" text="Nie znaleziono ula." /></View>
      </View>
    );
  } else {
    body = (
      <List
        hives={hives}
        error={error}
        refreshing={refreshing}
        onRefresh={refresh}
        onOpen={(id) => setScreen({ name: 'details', id })}
        onAdd={() => setScreen({ name: 'add' })}
      />
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={s.container}>{body}</View>
    </View>
  );
}

export default function App() {
  const [loaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });
  if (!loaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <Root />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

// ---- styles ----------------------------------------------------------------

const box = { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface };

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  scroll: { padding: 20, paddingTop: 12, paddingBottom: 120 },
  muted: { color: C.muted },
  sectionLabel: { color: C.muted, letterSpacing: 0.8, marginTop: 28, marginBottom: 10, fontSize: 12 },

  brand: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 20 },
  logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.honey, alignItems: 'center', justifyContent: 'center' },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18 },
  summaryIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  alertHero: { backgroundColor: C.alert, borderRadius: 24, padding: 22 },
  alertHeroIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  alertHalo: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.3)' },
  alertKicker: { color: 'rgba(255,255,255,0.8)', letterSpacing: 1.5, marginTop: 16, fontSize: 12 },
  alertTitle: { color: '#fff', marginTop: 2 },
  alertSub: { color: 'rgba(255,255,255,0.9)', marginTop: 6 },

  card: { ...box, borderRadius: 20 },
  cardAlert: { backgroundColor: '#FFF5F6', borderColor: C.alertLine },
  cardTouch: { borderRadius: 20 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  ringSvg: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  countdown: { fontFamily: 'Inter_700Bold', fontVariant: ['tabular-nums'] },

  fab: { position: 'absolute', right: 20, borderRadius: 18 },

  empty: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 24 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.honeySoft, alignItems: 'center', justifyContent: 'center' },

  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, marginTop: 12 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },

  panel: { ...box, borderRadius: 20, padding: 16 },
  input: { backgroundColor: C.surface, fontSize: 15 },
  hint: { color: C.muted, marginTop: 4, marginLeft: 4 },

  btn: { borderRadius: 14 },
  btnContent: { height: 50 },
  btnLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, letterSpacing: 0 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 18, padding: 18, borderRadius: 22 },
  heroCountdown: { fontFamily: 'Inter_700Bold', fontVariant: ['tabular-nums'] },
  statsPanel: { ...box, flexDirection: 'row', alignItems: 'center', borderRadius: 20, marginTop: 12, paddingVertical: 14 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: C.line },

  logPanel: { ...box, borderRadius: 20, overflow: 'hidden' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  logDivider: { borderBottomWidth: 1, borderBottomColor: C.line },
  logIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
