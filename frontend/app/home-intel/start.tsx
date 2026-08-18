import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const PENDING_KEY = "diyhomie_pending_intent";

const CHIPS = [
  { label: "Fix something", icon: "wrench-outline", prefix: "I need to fix " },
  { label: "Build something", icon: "hammer", prefix: "I want to build " },
  { label: "Remodel", icon: "home-edit-outline", prefix: "I want to remodel " },
  { label: "Maintain", icon: "calendar-check-outline", prefix: "I want to maintain " },
  { label: "Design", icon: "palette-outline", prefix: "I want to redesign " },
  { label: "Learn", icon: "school-outline", prefix: "How do I " },
] as const;

type IntentResult = {
  intent_id: string; guest_token: string; is_emergency: boolean; need_type: string;
  category?: string; save_prompt?: string;
  safety?: { message: string; guidance: string };
  result?: { likely_diagnosis: string; safe_immediate_action: string; next_step: string; first_questions?: string[]; outline?: string[] };
  triage?: { risk_level: string; message?: string | null };
};

type ChecklistStep = { key: string; label: string; done: boolean };
type Checklist = { has_project: boolean; issue_id?: string; issue_description?: string; steps: ChecklistStep[]; progress: number };

export default function AskHomieStart() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [checklist, setChecklist] = useState<Checklist | null>(null);

  const loadChecklist = useCallback(async () => {
    try {
      const c = await api<Checklist>("/hi/start/checklist");
      setChecklist(c.has_project ? c : null);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => {
      const t = await getToken();
      setLoggedIn(!!t);
      if (t) {
        loadChecklist();
        // Resume: claim a pending guest intent after signup/login.
        const pending = await storage.secureGet<string>(PENDING_KEY, "");
        if (pending) {
          try {
            const r = await api<{ issue_id: string }>("/hi/start/claim", { method: "POST", body: { intent_id: pending } });
            await storage.secureRemove(PENDING_KEY);
            router.push(`/home-intel/repair/${r.issue_id}`);
          } catch { await storage.secureRemove(PENDING_KEY); }
        }
      }
    })();
  }, [loadChecklist, router]));

  const submit = async () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true); setError(null); setIntent(null);
    try {
      const r = await api<IntentResult>("/hi/start/intent", { method: "POST", body: { text: text.trim() } });
      setIntent(r);
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Try again.");
    } finally { setBusy(false); }
  };

  const saveProject = async () => {
    if (!intent || claiming) return;
    if (!loggedIn) {
      await storage.secureSet(PENDING_KEY, intent.intent_id);
      router.push("/auth");
      return;
    }
    setClaiming(true);
    try {
      const r = await api<{ issue_id: string }>("/hi/start/claim", { method: "POST", body: { intent_id: intent.intent_id } });
      router.push(`/home-intel/repair/${r.issue_id}`);
    } catch (e: any) {
      setError(e?.message || "Couldn't save the project.");
    } finally { setClaiming(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Ask Homie" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>What are you working on?</Text>
          <Text style={styles.sub}>Describe it in your own words — a repair, a build, a question. Homie helps first, no setup required.</Text>

          <View style={styles.inputWrap}>
            <TextInput
              testID="start-intent-input"
              style={styles.input}
              placeholder={'e.g. "My toilet keeps running"'}
              placeholderTextColor={colors.onSurfaceTertiary}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={800}
            />
            <Pressable testID="start-intent-submit" style={[styles.sendBtn, (text.trim().length < 3 || busy) && { opacity: 0.4 }]} onPress={submit} disabled={text.trim().length < 3 || busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <MaterialCommunityIcons name="arrow-up" size={22} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>

          <View style={styles.chips}>
            {CHIPS.map((c) => (
              <Pressable key={c.label} testID={`start-chip-${c.label}`} style={styles.chip} onPress={() => setText(c.prefix)}>
                <MaterialCommunityIcons name={c.icon as any} size={16} color={colors.brandPrimary} />
                <Text style={styles.chipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable testID="start-new-home" style={styles.newHomeCard} onPress={() => router.push("/home-intel/new-home")}>
            <MaterialCommunityIcons name="key-variant" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>I just bought a home</Text>
              <Text style={styles.cardSub}>A calm first-home setup: safety checks, key systems & your first maintenance calendar</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.brandPrimary} />
          </Pressable>

          {error && <Text style={styles.error}>{error}</Text>}

          {intent?.is_emergency && intent.safety && (
            <View testID="start-safety-panel" style={styles.safetyCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <MaterialCommunityIcons name="alert-octagon" size={22} color={colors.onError} />
                <Text style={styles.safetyTitle}>Safety first — stop here</Text>
              </View>
              <Text style={styles.safetyText}>{intent.safety.message}</Text>
              <Text style={styles.safetyGuide}>{intent.safety.guidance}</Text>
              <Pressable testID="start-emergency-link" style={styles.safetyBtn} onPress={() => router.push("/emergency")}>
                <Text style={styles.safetyBtnText}>Open emergency guidance</Text>
              </Pressable>
            </View>
          )}

          {intent && !intent.is_emergency && intent.result && (
            <View testID="start-result-card" style={styles.resultCard}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>{intent.need_type}</Text></View>
                {intent.category ? <View style={styles.badgeAlt}><Text style={styles.badgeAltText}>{intent.category.replace(/_/g, " ")}</Text></View> : null}
              </View>
              <Text style={styles.resLabel}>{"What's likely going on"}</Text>
              <Text style={styles.resText}>{intent.result.likely_diagnosis}</Text>
              <Text style={styles.resLabel}>Do this right now</Text>
              <Text style={styles.resText}>{intent.result.safe_immediate_action}</Text>
              {!!intent.triage?.message && <Text style={styles.cautionText}>{intent.triage.message}</Text>}
              <View style={styles.nextStep}>
                <MaterialCommunityIcons name="foot-print" size={18} color={colors.brandPrimary} />
                <Text style={styles.nextStepText}>{intent.result.next_step}</Text>
              </View>
              {!!intent.result.outline?.length && (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.resLabel}>How this will go</Text>
                  {intent.result.outline.map((o, i) => (
                    <Text key={i} style={styles.outlineItem}>{i + 1}.  {o}</Text>
                  ))}
                </View>
              )}
              <Pressable testID="start-save-project" style={styles.saveBtn} onPress={saveProject} disabled={claiming}>
                {claiming ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : (
                  <Text style={styles.saveBtnText}>{loggedIn ? "Save as my project" : "Create free account & save this project"}</Text>
                )}
              </Pressable>
              {!loggedIn && <Text style={styles.savePrompt}>{intent.save_prompt}</Text>}
            </View>
          )}

          {loggedIn && checklist && !intent && (
            <View testID="start-first-checklist" style={styles.checkCard}>
              <Text style={styles.cardTitle}>Your first project</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{checklist.issue_description}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${checklist.progress}%` }]} /></View>
              {checklist.steps.map((s) => (
                <View key={s.key} style={styles.stepRow}>
                  <MaterialCommunityIcons name={s.done ? "check-circle" : "checkbox-blank-circle-outline"} size={18} color={s.done ? colors.success : colors.onSurfaceTertiary} />
                  <Text style={[styles.stepText, s.done && { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" }]}>{s.label}</Text>
                </View>
              ))}
              <Pressable testID="start-continue-project" style={styles.continueBtn} onPress={() => checklist.issue_id && router.push(`/home-intel/repair/${checklist.issue_id}`)}>
                <Text style={styles.continueText}>Continue project</Text>
                <MaterialCommunityIcons name="arrow-right" size={18} color={colors.brandPrimary} />
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  h1: { fontFamily: font.display, fontSize: type["3xl"], color: colors.onSurface },
  sub: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceTertiary, marginTop: spacing.xs, marginBottom: spacing.lg },
  inputWrap: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  input: { flex: 1, minHeight: 64, maxHeight: 140, color: colors.onSurface, fontFamily: font.regular, fontSize: type.lg, textAlignVertical: "top" },
  sendBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  chipText: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurfaceSecondary },
  newHomeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.xl },
  cardTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  cardSub: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  error: { color: colors.error, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.md },
  safetyCard: { backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.xl, gap: spacing.sm },
  safetyTitle: { fontFamily: font.bold, fontSize: type.xl, color: colors.onError },
  safetyText: { fontFamily: font.medium, fontSize: type.lg, color: colors.onError },
  safetyGuide: { fontFamily: font.regular, fontSize: type.base, color: colors.onError, opacity: 0.9 },
  safetyBtn: { backgroundColor: colors.onError, borderRadius: radius.pill, alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm, minHeight: 44 },
  safetyBtnText: { fontFamily: font.bold, fontSize: type.base, color: colors.error },
  resultCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.xl },
  badgeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  badge: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  badgeText: { fontFamily: font.bold, fontSize: type.sm, color: colors.onBrandPrimary, textTransform: "capitalize" },
  badgeAlt: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  badgeAltText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  resLabel: { fontFamily: font.bold, fontSize: type.sm, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.md },
  resText: { fontFamily: font.regular, fontSize: type.lg, color: colors.onSurface, marginTop: 4 },
  cautionText: { fontFamily: font.medium, fontSize: type.base, color: colors.warning, marginTop: spacing.sm },
  nextStep: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  nextStepText: { flex: 1, fontFamily: font.medium, fontSize: type.base, color: colors.onBrandTertiary },
  outlineItem: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, marginTop: 4 },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, marginTop: spacing.lg, minHeight: 48 },
  saveBtnText: { fontFamily: font.bold, fontSize: type.lg, color: colors.onBrandPrimary },
  savePrompt: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.sm },
  checkCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.xl },
  track: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginVertical: spacing.md },
  fill: { height: 6, backgroundColor: colors.brandPrimary, borderRadius: 3 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  stepText: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurface, flex: 1 },
  continueBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md, minHeight: 44 },
  continueText: { fontFamily: font.bold, fontSize: type.base, color: colors.brandPrimary },
});
