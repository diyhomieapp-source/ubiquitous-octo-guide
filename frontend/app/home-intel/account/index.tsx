import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Prefs = { experience_level: string; budget_sensitivity: string; risk_tolerance: string; tone: string; units: string };
type Prop = { id: string; name?: string | null; property_type?: string | null; year_built?: number | null; is_active?: boolean };
type Step = { key: string; label: string; done: boolean };
type Overview = { preferences: Prefs; properties: Prop[]; active_property_id: string | null; onboarding: { complete: boolean; steps: Step[]; progress: number } };

const PREF_FIELDS: { key: keyof Prefs; label: string; opts: { k: string; l: string }[] }[] = [
  { key: "experience_level", label: "DIY experience", opts: [{ k: "beginner", l: "Beginner" }, { k: "intermediate", l: "Intermediate" }, { k: "advanced", l: "Advanced" }] },
  { key: "budget_sensitivity", label: "Budget", opts: [{ k: "low", l: "Spend freely" }, { k: "medium", l: "Balanced" }, { k: "high", l: "Keep it cheap" }] },
  { key: "risk_tolerance", label: "Risk comfort", opts: [{ k: "cautious", l: "Cautious" }, { k: "balanced", l: "Balanced" }, { k: "hands_on", l: "Hands-on" }] },
  { key: "tone", label: "Homie's tone", opts: [{ k: "friendly", l: "Friendly" }, { k: "concise", l: "Concise" }, { k: "detailed", l: "Detailed" }] },
  { key: "units", label: "Units", opts: [{ k: "imperial", l: "Imperial (ft/in)" }, { k: "metric", l: "Metric (m/cm)" }] },
];
const PROP_TYPES = ["House", "Apartment", "Condo", "Townhouse", "Mobile Home", "Other"];

export default function Account() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", property_type: "House", year_built: "" });

  const load = useCallback(async () => {
    try { setOv(await api<Overview>("/hi/account/overview")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setPref = async (key: keyof Prefs, value: string) => {
    setOv((o) => o ? { ...o, preferences: { ...o.preferences, [key]: value } } : o);
    try { await api("/hi/account/preferences", { method: "PUT", body: { [key]: value } }); } catch { load(); }
  };
  const activate = async (id: string) => { try { await api(`/hi/account/properties/${id}/activate`, { method: "POST" }); load(); } catch {} };
  const addHome = async () => {
    if (!form.name.trim()) { Alert.alert("Name it", "Give this home a name."); return; }
    try {
      await api("/hi/account/properties", { method: "POST", body: { name: form.name.trim(), property_type: form.property_type, year_built: form.year_built ? parseInt(form.year_built, 10) : undefined } });
      setForm({ name: "", property_type: "House", year_built: "" }); setAdding(false); load();
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
  };
  const removeHome = (id: string) => {
    Alert.alert("Remove home?", "This removes the home profile.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => { try { await api(`/hi/account/properties/${id}`, { method: "DELETE" }); load(); } catch (e: any) { Alert.alert("Can't remove", e?.message || "Try again."); } } },
    ]);
  };

  if (loading || !ov) return <View style={styles.root}><ScreenHeader title="Setup & Preferences" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Setup & Preferences" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        {!ov.onboarding.complete && (
          <View style={styles.progressCard}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>Get set up</Text>
              <Text style={styles.progressPct}>{ov.onboarding.progress}%</Text>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${ov.onboarding.progress}%` }]} /></View>
            {ov.onboarding.steps.map((s) => (
              <View key={s.key} style={styles.stepRow}>
                <MaterialCommunityIcons name={s.done ? "check-circle" : "circle-outline"} size={18} color={s.done ? colors.success : colors.onSurfaceTertiary} />
                <Text style={[styles.stepText, s.done && { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>Guidance preferences</Text>
        <Text style={styles.hint}>Homie tailors its chat and project plans to these.</Text>
        {PREF_FIELDS.map((f) => (
          <View key={f.key} style={{ marginTop: spacing.md }}>
            <Text style={styles.label}>{f.label}</Text>
            <View style={styles.chips}>
              {f.opts.map((o) => {
                const on = ov.preferences[f.key] === o.k;
                return (
                  <Pressable key={o.k} testID={`pref-${f.key}-${o.k}`} style={[styles.chip, on && styles.chipOn]} onPress={() => setPref(f.key, o.k)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.l}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Text style={styles.section}>Your homes</Text>
        {ov.properties.map((p) => (
          <View key={p.id} style={[styles.home, p.is_active && styles.homeActive]}>
            <MaterialCommunityIcons name="home-city-outline" size={20} color={p.is_active ? colors.brandPrimary : colors.onSurfaceSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.homeName}>{p.name || "Unnamed home"}</Text>
              <Text style={styles.homeMeta}>{[p.property_type, p.year_built ? `built ${p.year_built}` : null].filter(Boolean).join(" · ") || "Add details"}</Text>
            </View>
            {p.is_active ? <View style={styles.activeTag}><Text style={styles.activeTagText}>ACTIVE</Text></View> : (
              <Pressable testID={`home-activate-${p.id}`} style={styles.activateBtn} onPress={() => activate(p.id)}><Text style={styles.activateText}>Set active</Text></Pressable>
            )}
            {!p.is_active && <Pressable onPress={() => removeHome(p.id)} style={{ padding: 6 }}><MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} /></Pressable>}
          </View>
        ))}

        {adding ? (
          <View style={styles.addCard}>
            <TextInput testID="home-name" style={styles.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Home name (e.g. Main house)" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={styles.chips}>{PROP_TYPES.map((t) => (<Pressable key={t} testID={`home-type-${t}`} style={[styles.chip, form.property_type === t && styles.chipOn]} onPress={() => setForm({ ...form, property_type: t })}><Text style={[styles.chipText, form.property_type === t && styles.chipTextOn]}>{t}</Text></Pressable>))}</View>
            <TextInput testID="home-year" style={styles.input} value={form.year_built} onChangeText={(v) => setForm({ ...form, year_built: v })} keyboardType="number-pad" placeholder="Year built (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable testID="home-save" style={styles.saveBtn} onPress={addHome}><Text style={styles.saveText}>Add home</Text></Pressable>
              <Pressable style={styles.ghost} onPress={() => setAdding(false)}><Text style={styles.ghostText}>Cancel</Text></Pressable>
            </View>
          </View>
        ) : (
          <Pressable testID="home-add" style={styles.addHome} onPress={() => setAdding(true)}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.brandPrimary} />
            <Text style={styles.addHomeText}>Add another home</Text>
          </Pressable>
        )}
        <Text style={styles.note}>New homes are saved to your account. Switching the active home for rooms, projects &amp; toolbox is coming next.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  progressCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  progressPct: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.lg },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surface, marginVertical: spacing.sm, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  stepText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: 2 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.xs },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  home: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  homeActive: { borderColor: colors.brandPrimary },
  homeName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  homeMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  activeTag: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  activeTagText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 9 },
  activateBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  activateText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  addCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  ghost: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  ghostText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  addHome: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  addHomeText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md, lineHeight: 18 },
});
