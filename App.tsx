import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';

type Carrier = 'JIO' | 'AIRTEL' | 'VI' | 'BSNL';

interface DataPlan {
  id: string;
  carrier: Carrier;
  amount: string;
  label: string;
  isCustom?: boolean;
}

const CARRIERS: Carrier[] = ['JIO', 'AIRTEL', 'VI', 'BSNL'];

const NPCI_NUMBER = '08045163666';
const DEFAULT_TEMPLATE = `${NPCI_NUMBER},,,2,,,1,,,{PHONE}#,,,{AMOUNT}#`;

const DEFAULT_DATA_PLANS: DataPlan[] = [
  { id: 'j1', carrier: 'JIO', amount: '11', label: '10GB Data Booster (1 Hr)' },
  { id: 'j2', carrier: 'JIO', amount: '15', label: 'Unlimited 5G Booster (1 Day)' },
  { id: 'j3', carrier: 'JIO', amount: '19', label: '1GB Data Booster' },
  { id: 'j4', carrier: 'JIO', amount: '29', label: '2GB Data Booster' },
  { id: 'j5', carrier: 'JIO', amount: '49', label: '25GB Data Booster (1 Day)' },
  { id: 'a1', carrier: 'AIRTEL', amount: '22', label: '1GB Data Pack (1 Day)' },
  { id: 'a2', carrier: 'AIRTEL', amount: '26', label: '1.5GB Data Pack (1 Day)' },
  { id: 'a3', carrier: 'AIRTEL', amount: '33', label: '2GB Data Pack (1 Day)' },
  { id: 'a4', carrier: 'AIRTEL', amount: '49', label: '20GB Data Pack (1 Day)' },
  { id: 'v1', carrier: 'VI', amount: '23', label: '1GB Data Pack (1 Day)' },
  { id: 'v2', carrier: 'VI', amount: '26', label: '1.5GB Data Pack (1 Day)' },
  { id: 'v3', carrier: 'VI', amount: '33', label: '2GB Data Pack' },
  { id: 'v4', carrier: 'VI', amount: '49', label: '20GB Data Pack (1 Day)' },
  { id: 'b1', carrier: 'BSNL', amount: '16', label: '2GB Data Pack (1 Day)' },
  { id: 'b2', carrier: 'BSNL', amount: '19', label: '2GB Data Pack (1 Day)' },
  { id: 'b3', carrier: 'BSNL', amount: '49', label: '10GB Data Pack' },
  { id: 'b4', carrier: 'BSNL', amount: '58', label: 'Data STV' },
];

// Emergency backup per carrier (USSD codes are dialled as-is).
const USSD_BACKUP: Record<Exclude<Carrier, 'JIO'>, { code: string; label: string }> = {
  AIRTEL: { code: '*567*3#', label: 'Airtel emergency data loan' },
  VI: { code: '*111*6#', label: 'Vi data loan' },
  BSNL: { code: '*124*2#', label: 'BSNL data STV menu' },
};

const KEY_USER = '@ZEROMB_USER_V1';
const KEY_PLANS = '@ZEROMB_PLANS_V1';
const KEY_TEMPLATE = '@ZEROMB_TEMPLATE_V1';

const isCarrier = (v: unknown): v is Carrier => CARRIERS.includes(v as Carrier);

const isPlan = (p: any): p is DataPlan =>
  p &&
  typeof p.id === 'string' &&
  isCarrier(p.carrier) &&
  typeof p.amount === 'string' &&
  typeof p.label === 'string';

async function dial(sequence: string) {
  // '#' must be percent-encoded in a tel: URI. '*' and ',' are fine as-is.
  const url = `tel:${sequence.replace(/#/g, '%23')}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open the dialer', 'This device could not open a phone dialer.');
  }
}

export default function App() {
  const [phone, setPhone] = useState('');
  const [carrier, setCarrier] = useState<Carrier>('JIO');
  const [plans, setPlans] = useState<DataPlan[]>(DEFAULT_DATA_PLANS);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [u, p, t] = await Promise.all([
          AsyncStorage.getItem(KEY_USER),
          AsyncStorage.getItem(KEY_PLANS),
          AsyncStorage.getItem(KEY_TEMPLATE),
        ]);
        if (u) {
          const parsed = JSON.parse(u);
          if (typeof parsed.phone === 'string') setPhone(parsed.phone);
          if (isCarrier(parsed.carrier)) setCarrier(parsed.carrier);
        }
        if (p) {
          const parsed = JSON.parse(p);
          if (Array.isArray(parsed) && parsed.every(isPlan)) setPlans(parsed);
        }
        if (t) setTemplate(t);
      } catch {
        // Corrupt or unreadable storage: fall back to defaults.
      } finally {
        loaded.current = true;
      }
    })();
  }, []);

  const persist = (key: string, value: string) => {
    if (!loaded.current) return;
    AsyncStorage.setItem(key, value).catch(() => {});
  };

  const updateUser = (newPhone: string, newCarrier: Carrier) => {
    setPhone(newPhone);
    setCarrier(newCarrier);
    persist(KEY_USER, JSON.stringify({ phone: newPhone, carrier: newCarrier }));
  };

  const updatePlans = (next: DataPlan[]) => {
    setPlans(next);
    persist(KEY_PLANS, JSON.stringify(next));
  };

  const updateTemplate = (next: string) => {
    setTemplate(next);
    persist(KEY_TEMPLATE, next);
  };

  const cleanAmount = (raw: string) => raw.replace(/[^0-9]/g, '').replace(/^0+/, '');

  const phoneValid = /^[6-9]\d{9}$/.test(phone);

  const recharge = async (rawAmount: string) => {
    const amount = cleanAmount(rawAmount);
    if (!phoneValid) {
      Alert.alert('Check your number', 'Enter your 10-digit mobile number at the top first.');
      return;
    }
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter the exact pack price in rupees.');
      return;
    }
    if (!template.includes('{PHONE}') || !template.includes('{AMOUNT}')) {
      Alert.alert('Dial sequence problem', 'The dial sequence must contain {PHONE} and {AMOUNT}.');
      return;
    }
    Clipboard.setStringAsync(amount).catch(() => {});
    await dial(template.replace('{PHONE}', phone).replace('{AMOUNT}', amount));
  };

  const addCustomPlan = () => {
    const amount = cleanAmount(customAmount);
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter the exact pack price in rupees, for example 39.');
      return;
    }
    if (plans.some((p) => p.carrier === carrier && p.amount === amount)) {
      Alert.alert('Already saved', `A â‚¹${amount} pack already exists for ${carrier}.`);
      return;
    }
    updatePlans([
      {
        id: Date.now().toString(),
        carrier,
        amount,
        label: customLabel.trim() || `Custom ${carrier} data pack`,
        isCustom: true,
      },
      ...plans,
    ]);
    setCustomAmount('');
    setCustomLabel('');
  };

  const deletePlan = (plan: DataPlan) => {
    Alert.alert('Remove pack', `Remove â‚¹${plan.amount} ${plan.label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => updatePlans(plans.filter((p) => p.id !== plan.id)),
      },
    ]);
  };

  const resetCarrierPlans = () => {
    Alert.alert('Reset packs', `Restore the default ${carrier} packs and remove your custom ones?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        onPress: () =>
          updatePlans([
            ...plans.filter((p) => p.carrier !== carrier),
            ...DEFAULT_DATA_PLANS.filter((p) => p.carrier === carrier),
          ]),
      },
    ]);
  };

  const carrierBackup = async () => {
    if (carrier === 'JIO') {
      const web = `https://www.jio.com/selfcare/recharge/mobility/?serviceId=${phone}&serviceType=mobility&next=PREPAID`;
      try {
        await Linking.openURL('myjio://');
      } catch {
        try {
          await Linking.openURL(web);
        } catch {
          Alert.alert('Could not open', 'Neither the MyJio app nor the Jio website could be opened.');
        }
      }
      return;
    }
    await dial(USSD_BACKUP[carrier].code);
  };

  const carrierPlans = plans.filter((p) => p.carrier === carrier);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>ZeroMB</Text>
        <Text style={styles.subtitle}>Recharge a data pack with zero internet, using UPI 123PAY</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Mobile number to recharge</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="10-digit mobile number"
            placeholderTextColor="#64748B"
            value={phone}
            onChangeText={(v) => updateUser(v.replace(/[^0-9]/g, ''), carrier)}
          />
          {phone.length === 10 && !phoneValid && (
            <Text style={styles.warn}>Indian mobile numbers start with 6, 7, 8 or 9.</Text>
          )}

          <Text style={[styles.label, styles.mt14]}>Operator</Text>
          <View style={styles.carrierRow}>
            {CARRIERS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, carrier === c && styles.chipActive]}
                onPress={() => updateUser(phone, c)}
              >
                <Text style={[styles.chipText, carrier === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>One-time setup</Text>
          <Text style={styles.helper}>
            Call the NPCI line once and say your bank's name so it knows which account to charge.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => dial(NPCI_NUMBER)}>
            <Text style={styles.secondaryBtnText}>Call 123PAY to link your bank</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>{carrier} data packs</Text>
            <TouchableOpacity onPress={resetCarrierPlans}>
              <Text style={styles.link}>Reset</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helper}>
            Tap a pack. The dialer opens with everything typed in. Press the green call button, then
            enter your UPI PIN when asked. The amount must match a real pack price, or the recharge
            is rejected and refunded.
          </Text>

          {carrierPlans.length === 0 && (
            <Text style={styles.helper}>No packs saved. Add one below or tap Reset.</Text>
          )}

          {carrierPlans.map((plan) => (
            <View key={plan.id} style={styles.planRow}>
              <TouchableOpacity style={styles.planMain} onPress={() => recharge(plan.amount)}>
                <View style={styles.planText}>
                  <Text style={styles.planLabel}>{plan.label}</Text>
                  {plan.isCustom && <Text style={styles.planMeta}>Custom</Text>}
                </View>
                <Text style={styles.planAmount}>â‚¹{plan.amount}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => deletePlan(plan)}>
                <Text style={styles.deleteText}>âœ•</Text>
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.customBox}>
            <Text style={styles.label}>Add a custom {carrier} pack</Text>
            <View style={styles.customRow}>
              <TextInput
                style={[styles.input, styles.flex1]}
                keyboardType="number-pad"
                placeholder="â‚¹ Price"
                placeholderTextColor="#64748B"
                value={customAmount}
                onChangeText={(v) => setCustomAmount(cleanAmount(v))}
              />
              <TextInput
                style={[styles.input, styles.flex2]}
                placeholder="Note (e.g. 3GB, 3 days)"
                placeholderTextColor="#64748B"
                value={customLabel}
                onChangeText={setCustomLabel}
              />
            </View>
            <View style={styles.customRow}>
              <TouchableOpacity style={[styles.secondaryBtn, styles.flex1]} onPress={addCustomPlan}>
                <Text style={styles.secondaryBtnText}>Save pack</Text>
              </TouchableOpacity>
              {customAmount.length > 0 && (
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.flex1]}
                  onPress={() => recharge(customAmount)}
                >
                  <Text style={styles.primaryBtnText}>Recharge â‚¹{customAmount}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Emergency backup</Text>
          <Text style={styles.helper}>
            {carrier === 'JIO'
              ? 'Opens the MyJio app, or the Jio recharge page if the app is missing. Jio sites may load without data balance.'
              : `Dials ${USSD_BACKUP[carrier].code} (${USSD_BACKUP[carrier].label}). Codes can change, check with your operator if it does nothing.`}
          </Text>
          <TouchableOpacity style={styles.dangerBtn} onPress={carrierBackup}>
            <Text style={styles.primaryBtnText}>
              {carrier === 'JIO' ? 'Open Jio recharge' : `Dial ${USSD_BACKUP[carrier].code}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => setShowAdvanced((s) => !s)}>
          <Text style={[styles.link, styles.center]}>
            {showAdvanced ? 'Hide' : 'Show'} advanced: dial sequence
          </Text>
        </TouchableOpacity>
        {showAdvanced && (
          <View style={[styles.card, styles.mt14]}>
            <Text style={styles.helper}>
              Each comma is a pause of about two seconds. {'{PHONE}'} and {'{AMOUNT}'} are filled in
              for you. If the 123PAY menu changes, edit the digits and pauses here.
            </Text>
            <TextInput
              style={styles.input}
              value={template}
              onChangeText={updateTemplate}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => updateTemplate(DEFAULT_TEMPLATE)}>
              <Text style={[styles.link, styles.mt14]}>Restore default sequence</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0B0F19' },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  container: { flex: 1, backgroundColor: '#0B0F19' },
  content: { padding: 18, paddingTop: 56, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#F8FAFC' },
  subtitle: { fontSize: 13, color: '#94A3B8', marginBottom: 18, marginTop: 2 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  mt14: { marginTop: 14 },
  center: { textAlign: 'center' },
  label: { color: '#CBD5E1', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  warn: { color: '#FBBF24', fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  carrierRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  chipActive: { backgroundColor: '#2563EB', borderColor: '#60A5FA' },
  chipText: { color: '#94A3B8', fontWeight: 'bold', fontSize: 13 },
  chipTextActive: { color: '#FFFFFF' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#38BDF8', fontSize: 12, fontWeight: '600' },
  helper: { color: '#94A3B8', fontSize: 12, marginTop: 4, marginBottom: 12, lineHeight: 17 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  planMain: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  planText: { flex: 1, paddingRight: 8 },
  planLabel: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  planMeta: { color: '#64748B', fontSize: 11, marginTop: 2 },
  planAmount: { color: '#4ADE80', fontSize: 18, fontWeight: 'bold' },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
  },
  deleteText: { color: '#F87171', fontSize: 14, fontWeight: 'bold' },
  customBox: { marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  customRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  secondaryBtn: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#F8FAFC', fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: '#16A34A',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  dangerBtn: {
    backgroundColor: '#DC2626',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
});
