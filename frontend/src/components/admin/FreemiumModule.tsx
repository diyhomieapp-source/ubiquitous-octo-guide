import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Cfg = { free_scans: number; free_guides: number; free_saved_projects: number; trial_days: number; upgrade_cta: string; price_label: string };
type Funnel = { stage: string; count: number };

export function FreemiumModule() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [totals, setTotals] = useState<any | null>(null);
  const [funnel, setFunnel] = useState<Funnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        api<Cfg>("/admin/freemium/config"),
        api<{ totals: any; funnel: Funnel[] }>("/admin/freemium/analytics"),
      ]);
      setCfg(c); setTotals(a.totals); setFunnel(a.funnel);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try { await api("/admin/freemium/config", { method: "PUT", body: cfg }); Alert.alert("Saved", "Freemium limits updated live."); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setSaving(false); }
  };

  if (loading || !cfg) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  const numField = (label: string, key: keyof Cfg) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput testID={`freemium-${key}`} style={styles.input} value={String(cfg[key])} keyboardType="numeric"
        onChangeText={(t) => setCfg({ ...cfg, [key]: parseInt(t) || 0 })} placeholderTextColor={colors.onSurfaceTertiary} />
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Freemium & Trials</Text>
      <Text style={styles.sub}>Tune free caps, trial length & upgrade CTAs live — no code deploy.</Text>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Users" value={String(totals.users)} />
          <Stat label="Paid" value={String(totals.paid)} />
          <Stat label="Conversion" value={`${totals.conversion_pct}%`} />
          <Stat label="Demos" value={String(totals.demo_started)} />
          <Stat label="CTA CTR" value={`${totals.cta_ctr}%`} />
        </View>
      )}

      <Text style={styles.section}>Conversion funnel</Text>
      {funnel.map((f, i) => (
        <View key={i} style={styles.funnelRow}>
          <Text style={styles.funnelLabel}>{f.stage}</Text>
          <View style={styles.trackWrap}><View style={[styles.fill, { width: `${Math.round(f.count / maxCount * 100)}%` }]} /></View>
          <Text style={styles.funnelCount}>{f.count}</Text>
        </View>
      ))}

      <Text style={styles.section}>Free plan limits</Text>
      <View style={styles.grid}>
        {numField("Free scans", "free_scans")}
        {numField("Free AR guides", "free_guides")}
        {numField("Saved projects", "free_saved_projects")}
        {numField("Trial days", "trial_days")}
      </View>
      <Text style={styles.fieldLabel}>Upgrade CTA copy</Text>
      <TextInput testID="freemium-cta" style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]} multiline value={cfg.upgrade_cta} onChangeText={(t) => setCfg({ ...cfg, upgrade_cta: t })} />
      <Text style={styles.fieldLabel}>Price label</Text>
      <TextInput testID="freemium-price" style={styles.input} value={cfg.price_label} onChangeText={(t) => setCfg({ ...cfg, price_label: t })} />

      <Pressable testID="freemium-save" style={styles.saveBtn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 62, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  funnelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  funnelLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, width: 130 },
  trackWrap: { flex: 1, height: 18, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 18, borderRadius: radius.sm, backgroundColor: colors.brandPrimary },
  funnelCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, width: 42, textAlign: "right" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  field: { flex: 1, minWidth: 130 },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11, marginBottom: 4, marginTop: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
