import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function TwinModule() {
  const [settings, setSettings] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, q] = await Promise.all([
        api<any>("/hi/admin/twin/settings"), api<any>("/hi/admin/twin/metrics"), api<any>("/hi/admin/twin/queue"),
      ]);
      setSettings(s); setMetrics(m); setQueue(q); setThreshold(String(s.conflict_threshold));
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleType = async (key: string, val: boolean) => {
    setBusy(true);
    try { const s = await api<any>("/hi/admin/twin/settings", { method: "PUT", body: { capture_types_enabled: { [key]: val } } }); setSettings(s); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const saveThreshold = async () => {
    setBusy(true);
    try { const s = await api<any>("/hi/admin/twin/settings", { method: "PUT", body: { conflict_threshold: parseFloat(threshold) } }); setSettings(s); Alert.alert("Saved", "Conflict threshold updated."); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !settings || !metrics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Digital Twin Capture</Text>
        <Pressable testID="tw-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Twins" value={metrics.twins} />
        <Stat label="Captures" value={metrics.capture_sessions} />
        <Stat label="Complete %" value={Math.round((metrics.completion_rate || 0) * 100)} />
        <Stat label="Open conf." value={metrics.open_conflicts} accent={metrics.open_conflicts > 0} />
        <Stat label="Resolved" value={metrics.resolved_conflicts} />
      </View>

      <Text style={styles.section}>Capture types</Text>
      {Object.entries(settings.capture_types_enabled).map(([k, v]) => (
        <Pressable key={k} testID={`tw-type-${k}`} disabled={busy} style={styles.typeRow} onPress={() => toggleType(k, !v)}>
          <Text style={styles.typeName}>{k.replace(/_/g, " ")}</Text>
          <MaterialCommunityIcons name={v ? "toggle-switch" : "toggle-switch-off-outline"} size={30} color={v ? colors.success : colors.onSurfaceTertiary} />
        </Pressable>
      ))}

      <Text style={styles.section}>Conflict threshold</Text>
      <Text style={styles.help}>Two measurements differing by more than this fraction (0–0.9) are flagged for review.</Text>
      <View style={styles.row}>
        <TextInput testID="tw-threshold" style={styles.input} value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" placeholder="0.10" placeholderTextColor={colors.onSurfaceTertiary} />
        <Pressable testID="tw-threshold-save" style={styles.saveBtn} disabled={busy} onPress={saveThreshold}><Text style={styles.saveText}>Save</Text></Pressable>
      </View>

      <Text style={styles.section}>Confidence distribution</Text>
      <View style={styles.wrap}>
        {Object.entries(metrics.twin_confidence_distribution || {}).map(([k, v]) => (
          <View key={k} style={styles.pill}><Text style={styles.pillText}>{k}: {String(v)}</Text></View>
        ))}
        {Object.keys(metrics.twin_confidence_distribution || {}).length === 0 && <Text style={styles.help}>No data yet.</Text>}
      </View>

      <Text style={styles.section}>Capture sources</Text>
      <View style={styles.wrap}>
        {Object.entries(metrics.capture_source_distribution || {}).map(([k, v]) => (
          <View key={k} style={styles.pill}><Text style={styles.pillText}>{k}: {String(v)}</Text></View>
        ))}
        {Object.keys(metrics.capture_source_distribution || {}).length === 0 && <Text style={styles.help}>No data yet.</Text>}
      </View>

      <Text style={styles.section}>Processing queue ({(queue?.processing || []).length})</Text>
      {(queue?.processing || []).length === 0 ? <Text style={styles.help}>No sessions in progress.</Text> :
        (queue.processing).slice(0, 10).map((s: any) => (
          <View key={s.id} style={styles.qRow}>
            <MaterialCommunityIcons name="progress-clock" size={16} color={colors.info} />
            <Text style={styles.qText} numberOfLines={1}>{s.capture_type} · {s.status} · {s.artifact_count} artifacts</Text>
          </View>
        ))}

      <Text style={styles.note}>Admins monitor capture quality without accessing private property photos or content. Future AR/LiDAR/MeasureAssist/plan-import capture types stay disabled until connectors are enabled.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 60, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.xs },
  typeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  typeName: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  row: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  pill: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11, textTransform: "capitalize" },
  qRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  qText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.xl },
});
