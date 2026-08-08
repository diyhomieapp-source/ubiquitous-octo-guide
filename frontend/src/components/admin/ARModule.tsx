import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const GUIDANCE_TYPES = ["orientation_marker", "placement_marker", "measurement_marker", "component_highlight",
  "sequence_overlay", "safe_zone", "before_after_overlay", "checklist_anchor", "inspection_marker"];

export function ARModule() {
  const [dash, setDash] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDash(await api<any>("/hi/admin/ar/dashboard")); } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const put = async (path: string, body: any) => {
    setBusy(true);
    try { await api(path, { method: "PUT", body }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const s = dash.settings;
  const disabled = new Set(s.disabled_guidance_types || []);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>AR Guidance</Text>
        <Pressable testID="ar-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Sessions" value={dash.total_sessions} />
        <Stat label="Completed" value={dash.by_status.completed} />
        <Stat label="Completion %" value={dash.completion_rate} />
        <Stat label="Failures" value={Object.values(dash.tracking_failures || {}).reduce((a: number, b: any) => a + b, 0)} accent />
      </View>

      <Text style={styles.section}>Feature rollout</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}><Text style={styles.k}>AR guidance enabled</Text><Switch testID="ar-feature-toggle" value={s.feature_enabled} onValueChange={(v) => put("/hi/admin/ar/settings", { feature_enabled: v })} trackColor={{ true: colors.brandPrimary }} /></View>
      </View>

      <Text style={styles.section}>Platforms</Text>
      <View style={styles.card}>
        {["ios", "android", "web"].map((p) => (
          <View key={p} style={styles.rowBetween}><Text style={styles.k}>{p}</Text><Switch value={!!s.platforms?.[p]} onValueChange={(v) => put("/hi/admin/ar/platforms", { platform: p, enabled: v })} trackColor={{ true: colors.brandPrimary }} /></View>
        ))}
        <Text style={styles.note}>Live camera AR is native-only (iOS/Android build). Web falls back to 2D/text automatically.</Text>
      </View>

      <Text style={styles.section}>Guidance templates</Text>
      <View style={styles.card}>
        {GUIDANCE_TYPES.map((g) => (
          <View key={g} style={styles.rowBetween}>
            <Text style={styles.k}>{g.replace(/_/g, " ")}</Text>
            <Switch value={!disabled.has(g)} onValueChange={(v) => put("/hi/admin/ar/guidance-types", { guidance_type: g, disabled: !v })} trackColor={{ true: colors.brandPrimary }} />
          </View>
        ))}
      </View>

      <Text style={styles.section}>Tracking failures</Text>
      <View style={styles.card}>
        {Object.keys(dash.tracking_failures || {}).length === 0 ? <Text style={styles.note}>No tracking failures recorded.</Text> :
          Object.entries(dash.tracking_failures).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>
      <Text style={styles.note}>AR never blocks standard instructions. Safety-critical & professional-only work is gated out of AR automatically.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && value > 0 && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
