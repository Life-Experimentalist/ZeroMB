import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Cellular from 'expo-cellular';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RS = '₹';
const CROSS = '✕';
const DOT = '•';

type Carrier = 'JIO' | 'AIRTEL' | 'VI' | 'BSNL';
type Speed = 'fast' | 'normal' | 'slow';

interface DataPlan {
  id: string;
  carrier: Carrier;
  amount: string;
  label: string;
  isCustom?: boolean;
}

interface Settings {
  carrier: Carrier;
  setupDone: boolean;
  langKey: string; // key that picks English in the first voice menu ('' to skip)
  menuKey: string; // key for mobile recharge in the main menu
  targetKey: string; // 1 = current phone, 2 = another phone
  confirmKey: string; // 1 = continue after it reads the number, operator and bank
  autoAmount: boolean; // type the amount into the call too
  speed: Speed;
}

const CARRIERS: Carrier[] = ['JIO', 'AIRTEL', 'VI', 'BSNL'];
const CARRIER_COLOR: Record<Carrier, string> = {
  JIO: '#3B82F6',
  AIRTEL: '#EF4444',
  VI: '#F59E0B',
  BSNL: '#10B981',
};

const NPCI_NUMBER = '08045163666';

// Each comma is a pause of about two seconds on Android dialers.
// Order: before language key, before menu key (the call says your name here),
// before current/another phone key, before confirm key (it reads number, operator, bank),
// before amount.
const WAITS: Record<Speed, [number, number, number, number, number]> = {
  fast: [2, 3, 1, 3, 1],
  normal: [3, 5, 2, 5, 2],
  slow: [5, 7, 3, 7, 3],
};
const SPEED_LABEL: Record<Speed, string> = { fast: 'Fast', normal: 'Normal', slow: 'Slow' };

const DEFAULT_SETTINGS: Settings = {
  carrier: 'JIO',
  setupDone: false,
  langKey: '3',
  menuKey: '3',
  targetKey: '1',
  confirmKey: '1',
  autoAmount: false,
  speed: 'normal',
};

const DEFAULT_PLANS: DataPlan[] = [
  { id: 'j1', carrier: 'JIO', amount: '11', label: '10GB, 1 hour' },
  { id: 'j2', carrier: 'JIO', amount: '15', label: 'Unlimited 5G, 1 day' },
  { id: 'j3', carrier: 'JIO', amount: '19', label: '1GB data' },
  { id: 'j4', carrier: 'JIO', amount: '29', label: '2GB data' },
  { id: 'j5', carrier: 'JIO', amount: '49', label: '25GB, 1 day' },
  { id: 'a1', carrier: 'AIRTEL', amount: '22', label: '1GB, 1 day' },
  { id: 'a2', carrier: 'AIRTEL', amount: '26', label: '1.5GB, 1 day' },
  { id: 'a3', carrier: 'AIRTEL', amount: '33', label: '2GB, 1 day' },
  { id: 'a4', carrier: 'AIRTEL', amount: '49', label: '20GB, 1 day' },
  { id: 'v1', carrier: 'VI', amount: '23', label: '1GB, 1 day' },
  { id: 'v2', carrier: 'VI', amount: '26', label: '1.5GB, 1 day' },
  { id: 'v3', carrier: 'VI', amount: '33', label: '2GB data' },
  { id: 'v4', carrier: 'VI', amount: '49', label: '20GB, 1 day' },
  { id: 'b1', carrier: 'BSNL', amount: '16', label: '2GB, 1 day' },
  { id: 'b2', carrier: 'BSNL', amount: '19', label: '2GB, 1 day' },
  { id: 'b3', carrier: 'BSNL', amount: '49', label: '10GB data' },
  { id: 'b4', carrier: 'BSNL', amount: '58', label: 'Data STV' },
];

const USSD_BACKUP: Record<Exclude<Carrier, 'JIO'>, { code: string; label: string }> = {
  AIRTEL: { code: '*567*3#', label: 'Airtel emergency data loan' },
  VI: { code: '*111*6#', label: 'Vi data loan' },
  BSNL: { code: '*124*2#', label: 'BSNL data STV menu' },
};

const KEY_SETTINGS = '@ZEROMB_SETTINGS_V3';
const KEY_SETTINGS_OLD = '@ZEROMB_SETTINGS_V2';
const KEY_PLANS = '@ZEROMB_PLANS_V1';

const isCarrier = (v: unknown): v is Carrier => CARRIERS.includes(v as Carrier);
const isPlan = (p: any): p is DataPlan =>
  p && typeof p.id === 'string' && isCarrier(p.carrier) && typeof p.amount === 'string' && typeof p.label === 'string';

const digitsOnly = (s: string) => s.replace(/[^0-9]/g, '');
const cleanAmount = (s: string) => digitsOnly(s).replace(/^0+/, '');

function buildSequence(s: Settings, amount: string): string {
  const [wLang, wMenu, wTarget, wConfirm, wAmount] = WAITS[s.speed];
  const c = (n: number) => ','.repeat(n);
  // The language menu only plays the first time, so a normal call goes straight
  // to the name readout and the main menu.
  let seq = NPCI_NUMBER;
  seq += c(wLang + wMenu) + s.menuKey;
  seq += c(wTarget) + s.targetKey;
  seq += c(wConfirm) + s.confirmKey;
  if (s.autoAmount) seq += c(wAmount) + amount + '#';
  return seq;
}

// One-off helper: at the end of the main menu, # opens account management and 1 changes the language.
function buildLanguageFix(s: Settings): string {
  const [wLang, wMenu] = WAITS[s.speed];
  const c = (n: number) => ','.repeat(n);
  return NPCI_NUMBER + c(wLang + wMenu + 3) + '#' + c(3) + '1' + c(4) + (s.langKey || '3');
}

// True when the web build was opened from the home screen icon (iOS and Android).
function isInstalledWeb(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as any;
  return nav.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function carrierFromName(name: string | null): Carrier | null {
  const n = (name || '').toLowerCase();
  if (n.includes('jio')) return 'JIO';
  if (n.includes('airtel')) return 'AIRTEL';
  if (n.includes('bsnl') || n.includes('cellone')) return 'BSNL';
  if (n === 'vi' || n.includes('vodafone') || n.includes('idea')) return 'VI';
  return null;
}

async function dial(sequence: string) {
  // '#' must be percent-encoded in a tel: URI.
  try {
    await Linking.openURL(`tel:${sequence.replace(/#/g, '%23')}`);
  } catch {
    Alert.alert('Could not open the dialer', 'This device could not open a phone dialer.');
  }
}

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [plans, setPlans] = useState<DataPlan[]>(DEFAULT_PLANS);
  const [ready, setReady] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editPacks, setEditPacks] = useState(false);
  const [showCall, setShowCall] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const loaded = useRef(false);
  const [detected, setDetected] = useState(false);
  const [installEvt, setInstallEvt] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onPrompt = (e: any) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installWeb = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try {
      await installEvt.userChoice;
    } catch {}
    setInstallEvt(null);
  };

  const detectCarrier = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const c = carrierFromName(await Cellular.getCarrierNameAsync());
      if (c) {
        setS((prev) => ({ ...prev, carrier: c }));
        setDetected(true);
      }
    } catch {
      // leave the manual choice
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [a, old, b] = await Promise.all([
          AsyncStorage.getItem(KEY_SETTINGS),
          AsyncStorage.getItem(KEY_SETTINGS_OLD),
          AsyncStorage.getItem(KEY_PLANS),
        ]);
        const key = (v: unknown, fallback: string) =>
          typeof v === 'string' && digitsOnly(v) ? digitsOnly(v) : fallback;
        if (a) {
          const p = JSON.parse(a);
          setS({
            carrier: isCarrier(p.carrier) ? p.carrier : 'JIO',
            setupDone: p.setupDone === true,
            langKey: typeof p.langKey === 'string' ? digitsOnly(p.langKey) : DEFAULT_SETTINGS.langKey,
            menuKey: key(p.menuKey, DEFAULT_SETTINGS.menuKey),
            targetKey: key(p.targetKey, DEFAULT_SETTINGS.targetKey),
            confirmKey: key(p.confirmKey, DEFAULT_SETTINGS.confirmKey),
            autoAmount: p.autoAmount === true,
            speed: p.speed in WAITS ? p.speed : 'normal',
          });
        } else if (old) {
          // Keep the profile from 1.1.0 but use the corrected menu keys.
          const p = JSON.parse(old);
          setS({
            ...DEFAULT_SETTINGS,
            carrier: isCarrier(p.carrier) ? p.carrier : 'JIO',
            setupDone: p.setupDone === true,
          });
        }
        if (!a && !old) detectCarrier();
        if (b) {
          const p = JSON.parse(b);
          if (Array.isArray(p) && p.every(isPlan)) setPlans(p);
        }
      } catch {
        // fall back to defaults
      } finally {
        loaded.current = true;
        setReady(true);
      }
    })();
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    if (loaded.current) AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(next)).catch(() => {});
  };

  const updatePlans = (next: DataPlan[]) => {
    setPlans(next);
    if (loaded.current) AsyncStorage.setItem(KEY_PLANS, JSON.stringify(next)).catch(() => {});
  };

  const accent = CARRIER_COLOR[s.carrier];
  const carrierPlans = plans.filter((p) => p.carrier === s.carrier);
  const showSetup = !s.setupDone || editingProfile;

  const askRecharge = (rawAmount: string) => {
    const amount = cleanAmount(rawAmount);
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter the exact pack price in rupees.');
      return;
    }
    if (!s.menuKey || !s.targetKey || !s.confirmKey) {
      Alert.alert('Call setup', 'A menu key is empty. Fill in all keys under Call setup.');
      return;
    }
    setPending(amount);
  };

  const startRecharge = async () => {
    if (!pending) return;
    const amount = pending;
    setPending(null);
    await dial(buildSequence(s, amount));
  };

  const addCustomPlan = () => {
    const amount = cleanAmount(customAmount);
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter the exact pack price in rupees, for example 39.');
      return;
    }
    if (plans.some((p) => p.carrier === s.carrier && p.amount === amount)) {
      Alert.alert('Already saved', `A ${RS}${amount} pack already exists for ${s.carrier}.`);
      return;
    }
    updatePlans([
      { id: Date.now().toString(), carrier: s.carrier, amount, label: customLabel.trim() || 'Custom pack', isCustom: true },
      ...plans,
    ]);
    setCustomAmount('');
    setCustomLabel('');
  };

  const deletePlan = (plan: DataPlan) =>
    Alert.alert('Remove pack', `Remove ${RS}${plan.amount} (${plan.label})?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => updatePlans(plans.filter((p) => p.id !== plan.id)) },
    ]);

  const resetPlans = () =>
    Alert.alert('Reset packs', `Restore the default ${s.carrier} packs and remove your custom ones?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        onPress: () =>
          updatePlans([...plans.filter((p) => p.carrier !== s.carrier), ...DEFAULT_PLANS.filter((p) => p.carrier === s.carrier)]),
      },
    ]);

  const carrierBackup = async () => {
    if (s.carrier === 'JIO') {
      try {
        await Linking.openURL('myjio://');
      } catch {
        try {
          await Linking.openURL(
            `https://www.jio.com/selfcare/recharge/mobility/`
          );
        } catch {
          Alert.alert('Could not open', 'Neither the MyJio app nor the Jio website could be opened.');
        }
      }
      return;
    }
    await dial(USSD_BACKUP[s.carrier].code);
  };

  if (!ready) return <View style={styles.root} />;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>
            Zero<Text style={{ color: accent }}>MB</Text>
          </Text>
          <Text style={styles.tag}>Recharge data when you have none</Text>
        </View>

        {Platform.OS === 'web' && !isInstalledWeb() && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Install this so it works with no data</Text>
            {installEvt && (
              <Pressable style={[styles.primaryBtn, { backgroundColor: accent, marginBottom: 10 }]} onPress={installWeb}>
                <Text style={styles.primaryText}>Install app</Text>
              </Pressable>
            )}
            <Text style={styles.help}>
              iPhone: tap Share, then Add to Home Screen. Android: open the browser menu and tap Install app. Open it once
              while you still have data, after that it works offline.
            </Text>
          </View>
        )}

        {showSetup ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{s.setupDone ? 'Your details' : 'Set up in 2 steps'}</Text>

            <Text style={styles.step}>1. Your operator</Text>
            {detected && <Text style={styles.help}>Picked from your SIM. Change it if that is wrong.</Text>}
            <View style={styles.row}>
              {CARRIERS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => update({ carrier: c })}
                  style={[styles.chip, s.carrier === c && { backgroundColor: CARRIER_COLOR[c], borderColor: CARRIER_COLOR[c] }]}
                >
                  <Text style={[styles.chipText, s.carrier === c && { color: '#fff' }]}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.step}>2. Link your bank (once)</Text>
            <Text style={styles.help}>
              Call the NPCI line and say your bank's name, for example "SBI". Do this one time only.
            </Text>
            <Pressable style={styles.secondaryBtn} onPress={() => dial(NPCI_NUMBER)}>
              <Text style={styles.secondaryText}>Call 123PAY to link bank</Text>
            </Pressable>

            <Pressable
              style={[styles.primaryBtn, { backgroundColor: accent }]}
              onPress={() => {
                update({ setupDone: true });
                setEditingProfile(false);
              }}
            >
              <Text style={styles.primaryText}>{s.setupDone ? 'Save' : "Done, I'm set up"}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.profile} onPress={() => setEditingProfile(true)}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.profileText}>
              {s.carrier}
            </Text>
            <Text style={styles.link}>Edit</Text>
          </Pressable>
        )}

        {s.setupDone && !editingProfile && (
          <>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Pick a pack</Text>
              <View style={styles.row}>
                <Pressable onPress={() => setEditPacks((v) => !v)} hitSlop={8}>
                  <Text style={styles.link}>{editPacks ? 'Done' : 'Edit'}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.grid}>
              {carrierPlans.map((plan) => (
                <Pressable
                  key={plan.id}
                  style={({ pressed }) => [styles.pack, { borderColor: accent }, pressed && styles.pressed]}
                  onPress={() => (editPacks ? deletePlan(plan) : askRecharge(plan.amount))}
                >
                  <Text style={[styles.packAmount, { color: accent }]}>
                    {RS}
                    {plan.amount}
                  </Text>
                  <Text style={styles.packLabel} numberOfLines={2}>
                    {plan.label}
                  </Text>
                  {editPacks && <Text style={styles.remove}>{CROSS} Remove</Text>}
                </Pressable>
              ))}
            </View>
            {carrierPlans.length === 0 && <Text style={styles.help}>No packs saved. Add one below.</Text>}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Other amount</Text>
              <Text style={styles.help}>
                Type the exact price of any pack. A price that is not a real pack is rejected and refunded.
              </Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  keyboardType="number-pad"
                  placeholder={`${RS} Price`}
                  placeholderTextColor="#64748B"
                  value={customAmount}
                  onChangeText={(v) => setCustomAmount(cleanAmount(v))}
                />
                <TextInput
                  style={[styles.input, { flex: 2 }]}
                  placeholder="Note (optional)"
                  placeholderTextColor="#64748B"
                  value={customLabel}
                  onChangeText={setCustomLabel}
                />
              </View>
              <View style={styles.row}>
                <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={addCustomPlan}>
                  <Text style={styles.secondaryText}>Save pack</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { flex: 1, backgroundColor: accent, marginTop: 0 }, !customAmount && styles.disabled]}
                  disabled={!customAmount}
                  onPress={() => askRecharge(customAmount)}
                >
                  <Text style={styles.primaryText}>
                    Recharge {RS}
                    {customAmount || ''}
                  </Text>
                </Pressable>
              </View>
              <Pressable onPress={resetPlans} style={{ marginTop: 12 }}>
                <Text style={styles.link}>Reset {s.carrier} packs</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>No luck? Backup</Text>
              <Text style={styles.help}>
                {s.carrier === 'JIO'
                  ? 'Opens the MyJio app, or the Jio recharge page if the app is missing.'
                  : `Dials ${USSD_BACKUP[s.carrier].code} (${USSD_BACKUP[s.carrier].label}). Codes change, ask your operator if it does nothing.`}
              </Text>
              <Pressable style={styles.dangerBtn} onPress={carrierBackup}>
                <Text style={styles.primaryText}>
                  {s.carrier === 'JIO' ? 'Open Jio recharge' : `Dial ${USSD_BACKUP[s.carrier].code}`}
                </Text>
              </Pressable>
            </View>

            <Pressable onPress={() => setShowCall((v) => !v)} style={styles.moreLink}>
              <Text style={styles.link}>{showCall ? 'Hide' : 'Show'} call setup (if the menu goes wrong)</Text>
            </Pressable>
            {showCall && (
              <View style={styles.card}>
                <Text style={styles.help}>
                  The app presses menu keys for you after waiting for each voice prompt. If it presses too early, choose
                  Slow. If a key is wrong for your menu, change it here.
                </Text>

                <Text style={styles.step}>Key for English (only used by "Fix language")</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={2}
                  value={s.langKey}
                  onChangeText={(v) => update({ langKey: digitsOnly(v) })}
                />
                <Text style={styles.help}>
                  The language menu only plays on your very first call, so normal recharges skip it. If it got set to the
                  wrong language, use the button below. English is usually 3 and Hindi 2.
                </Text>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() =>
                    Alert.alert(
                      'Fix language',
                      'Opens the dialer. When the call connects it waits for the main menu, presses # (manage account), then 1 (change language), then the English key. Do not press anything yourself.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open dialer', onPress: () => dial(buildLanguageFix(s)) },
                      ],
                    )
                  }
                >
                  <Text style={styles.secondaryText}>Fix language to English</Text>
                </Pressable>

                <Text style={styles.step}>Key for Mobile Recharge in the main menu</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={2}
                  value={s.menuKey}
                  onChangeText={(v) => update({ menuKey: digitsOnly(v) })}
                />

                <Text style={styles.step}>Key for "current phone" (the other one is another phone)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={2}
                  value={s.targetKey}
                  onChangeText={(v) => update({ targetKey: digitsOnly(v) })}
                />

                <Text style={styles.step}>Key for "continue" after it reads your number and bank</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={2}
                  value={s.confirmKey}
                  onChangeText={(v) => update({ confirmKey: digitsOnly(v) })}
                />

                <View style={[styles.rowBetween, { marginTop: 14, marginBottom: 0 }]}>
                  <Text style={[styles.step, { flex: 1, marginTop: 0 }]}>Also type the amount into the call</Text>
                  <Switch value={s.autoAmount} onValueChange={(v) => update({ autoAmount: v })} />
                </View>
                <Text style={styles.help}>
                  Off by default. Keys typed when the call is not asking for an amount could count as wrong PIN
                  attempts. Turn on only if your call asks for the amount before the PIN.
                </Text>

                <Text style={styles.step}>Waiting speed</Text>
                <View style={styles.row}>
                  {(Object.keys(WAITS) as Speed[]).map((sp) => (
                    <Pressable
                      key={sp}
                      onPress={() => update({ speed: sp })}
                      style={[styles.chip, s.speed === sp && { backgroundColor: accent, borderColor: accent }]}
                    >
                      <Text style={[styles.chipText, s.speed === sp && { color: '#fff' }]}>{SPEED_LABEL[sp]}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.step}>Preview (each comma is about 2 seconds)</Text>
                <Text style={styles.mono}>{buildSequence(s, '19')}</Text>
              </View>
            )}

            <Text style={styles.footer}>
              Unofficial tool, not affiliated with NPCI or any operator. Your PIN is only typed into the call.
            </Text>
          </>
        )}
      </ScrollView>

      <Modal transparent animationType="fade" visible={pending !== null} onRequestClose={() => setPending(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              Recharge {RS}
              {pending} on {s.carrier}?
            </Text>
            <Text style={styles.help}>
              1. The dialer opens with the menu keys typed in.{'\n'}
              2. Press the green call button and wait.{'\n'}
              3. Do not press any keys while the voice speaks.{'\n'}
              {s.autoAmount
                ? `4. When asked, enter your UPI PIN.`
                : `4. If it asks for the amount, type ${pending} and press #. Then enter your UPI PIN.`}
            </Text>
            <Pressable style={[styles.primaryBtn, { backgroundColor: accent }]} onPress={startRecharge}>
              <Text style={styles.primaryText}>Open dialer</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => setPending(null)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F19' },
  content: { padding: 18, paddingTop: 56, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 18 },
  logo: { fontSize: 32, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.5 },
  tag: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  card: {
    backgroundColor: '#151C2C',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#243049',
  },
  cardTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  step: { color: '#CBD5E1', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  help: { color: '#94A3B8', fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  warn: { color: '#FBBF24', fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#243049',
  },
  mono: { color: '#CBD5E1', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  row: { flexDirection: 'row', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  chip: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#0B0F19',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#243049',
  },
  chipText: { color: '#94A3B8', fontWeight: '700', fontSize: 13 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151C2C',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#243049',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  profileText: { flex: 1, color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  sectionTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '700' },
  link: { color: '#38BDF8', fontSize: 13, fontWeight: '600' },
  moreLink: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  pack: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#151C2C',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    minHeight: 96,
  },
  pressed: { opacity: 0.7 },
  packAmount: { fontSize: 28, fontWeight: '800' },
  packLabel: { color: '#94A3B8', fontSize: 12.5, marginTop: 4 },
  remove: { color: '#F87171', fontSize: 12, fontWeight: '700', marginTop: 6 },
  primaryBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#243049', paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  secondaryText: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  dangerBtn: { backgroundColor: '#DC2626', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  footer: { color: '#64748B', fontSize: 11.5, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#151C2C', padding: 20, paddingBottom: 32, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetTitle: { color: '#F8FAFC', fontSize: 19, fontWeight: '800', marginBottom: 10 },
});
