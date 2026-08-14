import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const SRC_COLOR: Record<string, string> = { active: "#00E676", paused: "#FFC400", deprecated: "#EB5757" };

export function ImportModule() {
  const [dash, setDash] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api<any>("/hi/admin/import/dashboard"), api<any>("/hi/admin/import/sources")]);
      setDash(d); setSources(s.sources || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addSource = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api("/hi/admin/import/sources", { method: "POST", body: { source_name: name.trim(), source_type: "property_facts", reliability_level: "external_provider" } }); setName(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setStatus = async (sid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/import/sources/${sid}?status=${status}`, { method: "PUT" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}><Text style={styles.h1}>Property Import</Text><Pressable testID="imp-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable></View>
      <View style={styles.statRow}>
        <Stat label="Jobs" value={dash.total_jobs} />
        <Stat label="Issues" value={dash.total_issues} />
        <Stat label="Pending" value={dash.pending_review} accent={dash.pending_review > 0} />
        <Stat label="Sources" value={dash.sources} />
      </View>

      <Text style={styles.subhead}>Issues by type</Text>
      {Object.entries(dash.issues_by_type || {}).length === 0 ? <Text style={styles.note}>No reconciliation issues yet.</Text> :
        Object.entries(dash.issues_by_type || {}).map(([k, v]) => (
          <View key={k} style={styles.card}><View style={styles.labelRow}><Text style={styles.rTitle}>{k.replace("_", " ")}</Text><Text style={styles.rMeta}>{v as any}</Text></View></View>
        ))}

      <Text style={styles.subhead}>Data sources</Text>
      <View style={styles.addRow}>
        <TextInput testID="impadm-source" value={name} onChangeText={setName} placeholder="New provider name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.inputFlex} />
        <Pressable testID="impadm-add" disabled={busy} style={styles.addBtn} onPress={addSource}><Text style={styles.addBtnText}>Add</Text></Pressable>
      </View>
      {sources.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.labelRow}><Text style={styles.rTitle}>{s.source_name}</Text><View style={[styles.tag, { borderColor: SRC_COLOR[s.status] }]}><Text style={[styles.tagText, { color: SRC_COLOR[s.status] }]}>{s.status}</Text></View></View>
          <Text style={styles.rMeta}>{s.source_type} · {s.reliability_level}</Text>
          <View style={styles.actRow}>
            {s.status !== "active" ? <Pressable testID={`impadm-activate-${s.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setStatus(s.id, "active")}><Text style={styles.smallBtnText}>Activate</Text></Pressable> : null}
            {s.status !== "paused" ? <Pressable testID={`impadm-pause-${s.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: colors.warning }]} onPress={() => setStatus(s.id, "paused")}><Text style={[styles.smallBtnText, { color: colors.warning }]}>Pause</Text></Pressable> : null}
          </View>
        </View>
      ))}
      <Text style={styles.note}>External providers are informational, never authoritative. User-confirmed data is never auto-overwritten.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2 },
  subhead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  tagText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  inputFlex: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
