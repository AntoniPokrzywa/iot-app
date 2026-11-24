import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

const C = {
  yellow: '#EEC643', bg: '#FFF9E5', text: '#2B2412', muted: '#7A7260',
  green: '#2E7D4F', greenBg: '#E3F1E6', red: '#C62F3E', redBg: '#FBE3E6',
};

const INITIAL = [
  { id: 'VG-0154', name: 'Ul przy sadzie', lat: '50.0640', lng: '19.9440', alert: false, last: '14:32' },
  { id: 'VG-0157', name: 'Ul na łące', lat: '50.0647', lng: '19.9450', alert: true, last: '14:28' },
  { id: 'VG-0155', name: 'Ul pod lasem', lat: '50.0650', lng: '19.9460', alert: false, last: '14:15' },
  { id: 'VG-0156', name: 'Ul przy stawie', lat: '50.0655', lng: '19.9470', alert: false, last: '13:58' },
];

const LOGS = [
  { alert: true, text: 'Wykryto szerszenia', time: '14:43' },
  ...['14:40', '14:30', '14:20', '14:10', '14:00', '13:50'].map((t) => ({ alert: false, text: 'Ul bezpieczny', time: t })),
];

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

function List({ hives, onOpen, onAdd }) {
  return (
    <>
      <Header title="VespaGuard" subtitle="Ochrona Twoich uli przed szerszeniami" />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.section}>Twoje ule</Text>
        {hives.map((h) => (
          <TouchableOpacity key={h.id} style={s.card} onPress={() => onOpen(h.id)}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{h.name || h.id}</Text>
              <Text style={s.hint}>Ostatni sygnał: {h.last}</Text>
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
        <TouchableOpacity style={s.btn} onPress={() => f.id && onSave({ ...f, alert: false, last: '--:--' })}>
          <Text style={s.btnTxt}>Dodaj ul</Text>
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
  const set = (k) => (v) => setF({ ...f, [k]: v });
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
        <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => onSave(f)}>
          <Text style={s.btnTxt}>Zapisz zmiany</Text>
        </TouchableOpacity>
        <View style={s.logsHead}>
          <Text style={s.section}>Logi</Text>
          <Text style={s.hint}>Dziś</Text>
        </View>
        {LOGS.map((l, i) => (
          <View key={i} style={[s.log, l.alert && { backgroundColor: C.redBg }]}>
            <Text style={{ color: l.alert ? C.red : C.text, fontWeight: l.alert ? '700' : '500', fontSize: 12 }}>
              <Text style={{ color: l.alert ? C.red : C.green }}>● </Text>{l.text}
            </Text>
            <Text style={{ color: l.alert ? C.red : C.text, fontWeight: '700', fontSize: 12 }}>{l.time}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

export default function App() {
  const [hives, setHives] = useState(INITIAL);
  const [screen, setScreen] = useState({ name: 'list' });
  const home = () => setScreen({ name: 'list' });

  let body;
  if (screen.name === 'add') {
    body = <AddHive onCancel={home} onSave={(h) => { setHives([...hives, h]); home(); }} />;
  } else if (screen.name === 'details') {
    const hive = hives.find((h) => h.id === screen.id);
    body = (
      <Details
        key={hive.id}
        hive={hive}
        onBack={home}
        onSave={(u) => { setHives(hives.map((h) => (h.id === hive.id ? u : h))); home(); }}
      />
    );
  } else {
    body = <List hives={hives} onOpen={(id) => setScreen({ name: 'details', id })} onAdd={() => setScreen({ name: 'add' })} />;
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
