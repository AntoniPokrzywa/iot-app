import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api } from './api';

const C = {
  yellow: '#EEC643', bg: '#FFF9E5', text: '#2B2412', muted: '#7A7260',
  green: '#2E7D4F', greenBg: '#E3F1E6', red: '#C62F3E', redBg: '#FBE3E6',
};

const POLL_MS = 15000;

const pad = (n) => String(n).padStart(2, '0');

// ISO timestamp -> "HH:MM" today, "DD.MM HH:MM" otherwise (device local time).
function fmtTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}

function Message({ text, error, onRetry }) {
  return (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <Text style={{ color: error ? C.red : C.muted, textAlign: 'center' }}>{text}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={[s.btn, { marginTop: 12, paddingHorizontal: 24 }]}>
          <Text style={s.btnTxt}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Header({ title, subtitle, onBack }) {
  return (
    <View style={s.header}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={s.back}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
      )}
      <View>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function Field({ label, hint, ...props }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} placeholderTextColor="#A9A28F" {...props} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

function List({ hives, error, refreshing, onRefresh, onOpen, onAdd }) {
  return (
    <>
      <Header title="VespaGuard" subtitle="Ochrona Twoich uli przed szerszeniami" />
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={s.section}>Twoje ule</Text>
        {hives === null && !error && <ActivityIndicator color={C.muted} style={{ marginTop: 24 }} />}
        {error && <Message error text={error} onRetry={onRefresh} />}
        {hives && hives.length === 0 && <Message text="Nie masz jeszcze żadnych uli. Dodaj pierwszy przyciskiem +." />}
        {(hives || []).map((h) => (
          <TouchableOpacity key={h.id} style={s.card} onPress={() => onOpen(h.id)}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{h.name || h.id}</Text>
              <Text style={s.hint}>Ostatni sygnał: {fmtTime(h.last)}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: h.alert ? C.redBg : C.greenBg }]}>
              <Text style={{ color: h.alert ? C.red : C.green, fontSize: 11, fontWeight: '600' }}>
                ● {h.alert ? 'Wykryto szerszenia' : 'Ul bezpieczny'}
              </Text>
            </View>
            <Text style={s.chev}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={s.fabBar}>
        <TouchableOpacity style={s.fab} onPress={onAdd}>
          <Text style={{ fontSize: 28, color: C.text }}>+</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function AddHive({ onSave, onCancel }) {
  const [f, setF] = useState({ id: '', lat: '', lng: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    if (!f.id.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try { await onSave(f); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <>
      <Header title="Dodaj nowy ul" onBack={onCancel} />
      <View style={{ flex: 1, padding: 16 }}>
        <View style={{ flexDirection: 'row' }}>
          <Field label="ID ula" placeholder="np. VG-0158" hint="Znajdziesz je na naklejce urządzenia." value={f.id} onChangeText={set('id')} />
        </View>
        <Text style={[s.label, { marginTop: 16 }]}>Współrzędne geograficzne</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="Szerokość" placeholder="50.0647" keyboardType="numeric" value={f.lat} onChangeText={set('lat')} />
          <Field label="Długość" placeholder="19.9450" keyboardType="numeric" value={f.lng} onChangeText={set('lng')} />
        </View>
        <View style={{ flexDirection: 'row', marginTop: 16 }}>
          <Field label="Nazwa (opcjonalnie)" placeholder="np. Ul przy sadzie" hint="Będzie widoczna na liście uli." value={f.name} onChangeText={set('name')} />
        </View>
        <View style={{ flex: 1 }} />
        {err && <Text style={{ color: C.red, textAlign: 'center', marginBottom: 8 }}>{err}</Text>}
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          <Text style={s.btnTxt}>{busy ? 'Dodawanie…' : 'Dodaj ul'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ padding: 14, alignItems: 'center' }}>
          <Text style={{ color: C.muted, fontWeight: '600' }}>Anuluj</Text>
        </TouchableOpacity>
      </View>
    </>
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

  return (
    <>
      <Header title={hive.name || hive.id} subtitle={`ID: ${hive.id}`} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.section}>Dane ula</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="ID ula" value={f.id} onChangeText={set('id')} />
          <Field label="Nazwa" value={f.name} onChangeText={set('name')} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Field label="Szerokość" keyboardType="numeric" value={f.lat} onChangeText={set('lat')} />
          <Field label="Długość" keyboardType="numeric" value={f.lng} onChangeText={set('lng')} />
        </View>
        <TouchableOpacity style={[s.btn, { marginTop: 12 }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          <Text style={s.btnTxt}>{busy ? 'Zapisywanie…' : 'Zapisz zmiany'}</Text>
        </TouchableOpacity>
        <View style={s.logsHead}>
          <Text style={s.section}>Logi</Text>
        </View>
        {err && <Message error text={err} />}
        {logs === null && !err && <ActivityIndicator color={C.muted} style={{ marginTop: 12 }} />}
        {logs && logs.length === 0 && <Message text="Brak zdarzeń z tego ula." />}
        {(logs || []).map((l, i) => (
          <View key={i} style={[s.log, l.alert && { backgroundColor: C.redBg }]}>
            <Text style={{ color: l.alert ? C.red : C.text, fontWeight: l.alert ? '700' : '500', fontSize: 12 }}>
              <Text style={{ color: l.alert ? C.red : C.green }}>● </Text>{l.alert ? 'Wykryto szerszenia' : 'Ul bezpieczny'}
            </Text>
            <Text style={{ color: l.alert ? C.red : C.text, fontWeight: '700', fontSize: 12 }}>{fmtTime(l.ts)}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

export default function App() {
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
      <>
        <Header title="VespaGuard" onBack={home} />
        <Message text="Nie znaleziono ula." />
      </>
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
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      {body}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 30 },
  header: { backgroundColor: C.yellow, padding: 16, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  back: { marginRight: 12 },
  backTxt: { fontSize: 32, color: C.text, lineHeight: 32 },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 11, color: C.text },
  section: { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontWeight: '700', color: C.text, fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  chev: { fontSize: 22, color: C.muted },
  hint: { fontSize: 10, color: C.muted, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#EFE7CC', padding: 10, fontSize: 13, color: C.text },
  btn: { backgroundColor: C.yellow, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnTxt: { fontWeight: '800', color: C.text },
  logsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 },
  log: { backgroundColor: '#fff', borderRadius: 6, padding: 10, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' },
  fabBar: { backgroundColor: '#fff', alignItems: 'center', paddingVertical: 10, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center' },
});
