import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Scenario = { key: string; label: string; icon: string };
type Guide = {
  severity: string; call_authority?: string | null; headline: string;
  immediate_steps: string[]; do_not: string[]; temp_fix: string[]; document: string[];
  when_to_call_pro: string;
};
type Result = { id: string; scenario: string; scenario_label: string; guide: Guide; suggested_trade: string };

const SEV: Record<string, { color: string; label: string }> = {
  call_911: { color: "#E5484D", label: "CALL 911 NOW" },
  urgent: { color: "#F76B15", label: "URGENT" },
  caution: { color: "#F5A623", label: "CAUTION" },
};

export default function Emergency() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ scenarios: Scenario[] }>("/emergency/scenarios"); setScenarios(r.scenarios); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (s: Scenario) => {
    setSelected(s);
    setLoading(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      const r = await api<Result>("/emergency/triage", { method: "POST", body: { scenario: s.key, description: desc.trim() } });
      setResult(r);
    } catch { setLoading(false); return; }
    setLoading(false);
  };

  const reset = () => { setResult(null); setSelected(null); setDesc(""); };

  const sev = result ? (SEV[result.guide.severity] || SEV.urgent) : SEV.urgent;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="emg-back" hitSlop={10} onPress={() => (result ? reset() : router.back())}><MaterialCommunityIcons name="chevron-left" size={28} color="#fff" /></Pressable>
        <Text style={styles.headerTitle}>Emergency</Text>
        <View style={{ width: 28 }} />
      </View>

      {!result ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.introRow}>
            <MaterialCommunityIcons name="shield-alert" size={26} color="#E5484D" />
            <Text style={styles.intro}>What happened? Tap the closest match and I'll walk you through it — safety first.</Text>
          </View>
          <Text style={styles.emergencyNote}>If anyone is in danger, call <Text style={styles.link911} onPress={() => Linking.openURL("tel:911")}>911</Text> right now.</Text>

          <TextInput testID="emg-desc" style={styles.input} value={desc} onChangeText={setDesc}
            placeholder="Optional: describe it in a few words" placeholderTextColor="rgba(255,255,255,0.4)" />

          {loading ? (
            <View style={styles.loading}><ActivityIndicator size="large" color="#E5484D" /><Text style={styles.loadingText}>Building your triage plan…</Text></View>
          ) : (
            <View style={styles.grid}>
              {scenarios.map((s) => (
                <Pressable key={s.key} testID={`emg-scenario-${s.key}`} style={styles.card} onPress={() => run(s)}>
                  <MaterialCommunityIcons name={s.icon as any} size={30} color="#fff" />
                  <Text style={styles.cardLabel}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <View style={[styles.sevBanner, { backgroundColor: sev.color }]}>
            <MaterialCommunityIcons name="alert" size={18} color="#fff" />
            <Text style={styles.sevText}>{sev.label} · {result.scenario_label}</Text>
          </View>

          {!!result.guide.call_authority && (
            <Pressable style={styles.call911} onPress={() => Linking.openURL("tel:911")}>
              <MaterialCommunityIcons name="phone-alert" size={20} color="#fff" />
              <Text style={styles.call911Text}>{result.guide.call_authority}</Text>
            </Pressable>
          )}

          <Text style={styles.headline}>{result.guide.headline}</Text>

          <Section title="Do this now" icon="format-list-numbered" tint="#fff">
            {result.guide.immediate_steps.map((s, i) => (
              <View key={i} style={styles.stepRow}><Text style={styles.stepNum}>{i + 1}</Text><Text style={styles.stepText}>{s}</Text></View>
            ))}
          </Section>

          {result.guide.do_not?.length > 0 && (
            <Section title="Do NOT" icon="close-octagon" tint="#E5484D">
              {result.guide.do_not.map((s, i) => (
                <View key={i} style={styles.bulletRow}><MaterialCommunityIcons name="close-circle" size={15} color="#E5484D" /><Text style={styles.bulletText}>{s}</Text></View>
              ))}
            </Section>
          )}

          {result.guide.temp_fix?.length > 0 && (
            <Section title="Safe temporary fixes" icon="bandage" tint="#F5A623">
              {result.guide.temp_fix.map((s, i) => (
                <View key={i} style={styles.bulletRow}><MaterialCommunityIcons name="wrench" size={15} color="#F5A623" /><Text style={styles.bulletText}>{s}</Text></View>
              ))}
            </Section>
          )}

          {result.guide.document?.length > 0 && (
            <Section title="Document for insurance" icon="camera" tint="#3BA7FF">
              {result.guide.document.map((s, i) => (
                <View key={i} style={styles.bulletRow}><MaterialCommunityIcons name="check-circle-outline" size={15} color="#3BA7FF" /><Text style={styles.bulletText}>{s}</Text></View>
              ))}
            </Section>
          )}

          {!!result.guide.when_to_call_pro && (
            <View style={styles.proNote}><MaterialCommunityIcons name="information" size={16} color="rgba(255,255,255,0.7)" /><Text style={styles.proNoteText}>{result.guide.when_to_call_pro}</Text></View>
          )}

          {/* after-triage actions (never before safety) */}
          <Text style={styles.actionsHead}>Get help</Text>
          <Pressable testID="emg-find-pros" style={styles.actionBtn} onPress={() => router.push(`/pros?trade=${encodeURIComponent(result.suggested_trade)}`)}>
            <MaterialCommunityIcons name="account-hard-hat" size={20} color="#fff" />
            <Text style={styles.actionText}>Find nearby {result.suggested_trade} pros</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
          <Pressable testID="emg-ask-neighbors" style={styles.actionBtn} onPress={() => router.push("/neighborhood")}>
            <MaterialCommunityIcons name="account-group" size={20} color="#fff" />
            <Text style={styles.actionText}>Ask neighbors for supplies/help</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
          <Pressable testID="emg-records" style={styles.actionBtn} onPress={() => router.push("/portfolio")}>
            <MaterialCommunityIcons name="file-document" size={20} color="#fff" />
            <Text style={styles.actionText}>View home records (auto-logged)</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>

          <View style={styles.loggedNote}>
            <MaterialCommunityIcons name="check-decagram" size={15} color="#4ADE80" />
            <Text style={styles.loggedText}>Saved to your home timeline for insurance & FEMA records.</Text>
          </View>

          <Pressable testID="emg-new" style={styles.resetBtn} onPress={reset}><Text style={styles.resetText}>Report another issue</Text></Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function Section({ title, icon, tint, children }: { title: string; icon: string; tint: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><MaterialCommunityIcons name={icon as any} size={16} color={tint} /><Text style={[styles.sectionTitle, { color: tint }]}>{title}</Text></View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141414" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: "rgba(255,255,255,0.08)", borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: "#fff", fontFamily: font.display, fontSize: 22 },
  introRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginBottom: spacing.sm },
  intro: { flex: 1, color: "rgba(255,255,255,0.9)", fontFamily: font.medium, fontSize: type.lg, lineHeight: 24 },
  emergencyNote: { color: "rgba(255,255,255,0.6)", fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.md },
  link911: { color: "#E5484D", fontFamily: font.bold, textDecorationLine: "underline" },
  input: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: "#fff", fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "47%", flexGrow: 1, alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.lg },
  cardLabel: { color: "#fff", fontFamily: font.bold, fontSize: type.base, textAlign: "center" },
  loading: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["3xl"] },
  loadingText: { color: "rgba(255,255,255,0.7)", fontFamily: font.medium, fontSize: type.base },
  sevBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
  sevText: { color: "#fff", fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  call911: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#E5484D", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  call911Text: { flex: 1, color: "#fff", fontFamily: font.bold, fontSize: type.base },
  headline: { color: "#fff", fontFamily: font.display, fontSize: 24, lineHeight: 30, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: type.lg },
  stepRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm, alignItems: "flex-start" },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", color: "#fff", textAlign: "center", lineHeight: 24, fontFamily: font.bold, fontSize: type.sm, overflow: "hidden" },
  stepText: { flex: 1, color: "rgba(255,255,255,0.92)", fontFamily: font.medium, fontSize: type.lg, lineHeight: 24 },
  bulletRow: { flexDirection: "row", gap: spacing.sm, marginBottom: 6, alignItems: "flex-start" },
  bulletText: { flex: 1, color: "rgba(255,255,255,0.85)", fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  proNote: { flexDirection: "row", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  proNoteText: { flex: 1, color: "rgba(255,255,255,0.75)", fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  actionsHead: { color: "#fff", fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  actionText: { flex: 1, color: "#fff", fontFamily: font.bold, fontSize: type.base },
  loggedNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  loggedText: { color: "rgba(255,255,255,0.6)", fontFamily: font.regular, fontSize: type.sm },
  resetBtn: { alignItems: "center", paddingVertical: spacing.lg, marginTop: spacing.md },
  resetText: { color: "rgba(255,255,255,0.7)", fontFamily: font.bold, fontSize: type.base, textDecorationLine: "underline" },
});
