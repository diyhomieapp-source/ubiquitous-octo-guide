import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const SEV_COLOR: Record<string, string> = { low: "#888", medium: "#2F80ED", high: "#F2994A", critical: "#EB5757" };
const ISTATUS_COLOR: Record<string, string> = { detected: "#EB5757", investigating: "#F2994A", contained: "#2F80ED", resolved: "#27AE60" };

export function DataGovernanceModule() {
  const [dash, setDash] = useState<any>(null);
  const [retention, setRetention] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [deletions, setDeletions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [itype, setItype] = useState("");
  const [isev, setIsev] = useState("medium");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, r, i, del] = await Promise.all([
        api<any>("/hi/admin/privacy/dashboard"), api<any>("/hi/admin/privacy/retention"),
        api<any>("/hi/admin/privacy/incidents"), api<any>("/hi/admin/privacy/deletions"),
      ]);
      setDash(d); setRetention(r.policies || []); setIncidents(i.incidents || []); setDeletions(del.deletions || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createIncident = async () => {
    if (!itype.trim()) { Alert.alert("Type needed", "Describe the incident type."); return; }
    setBusy(true);
    try { await api("/hi/admin/privacy/incidents", { method: "POST", body: { incident_type: itype.trim(), severity: isev } }); setItype(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setIncidentStatus = async (iid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/privacy/incidents/${iid}`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Data Governance</Text>
        <Pressable testID="dg-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Pending deletions" value={dash.pending_deletions} accent={dash.pending_deletions > 0} />
        <Stat label="Deletion jobs" value={dash.queued_deletion_jobs} />
        <Stat label="Exports" value={dash.exports_total} />
        <Stat label="Open incidents" value={dash.open_incidents} accent={dash.open_incidents > 0} />
      </View>

      <Text style={styles.section}>Account states</Text>
      <View style={styles.card}>
        {Object.entries(dash.account_states || {}).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Granted consents</Text>
      <View style={styles.card}>
        {Object.entries(dash.granted_consents || {}).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Retention policies ({retention.length})</Text>
      {retention.map((p) => (
        <View key={p.data_category} style={styles.card}>
          <Text style={styles.rTitle}>{p.data_category.replace(/_/g, " ")}</Text>
          <Text style={styles.rMeta}>{p.retention_period} · {p.deletion_method.replace(/_/g, " ")}{p.legal_hold_supported ? " · legal hold" : ""}</Text>
        </View>
      ))}

      <Text style={styles.section}>Pending account deletions ({deletions.length})</Text>
      {deletions.length === 0 ? <Text style={styles.note}>No pending deletions.</Text> :
        deletions.map((d) => (
          <View key={d.user_id} style={styles.card}>
            <Text style={styles.rTitle}>User {String(d.user_id).slice(0, 8)}</Text>
            <Text style={styles.rMeta}>Requested {String(d.deletion_requested_at || "").slice(0, 10)} · effective {String(d.deletion_effective_at || "").slice(0, 10)} · {(d.retention_exceptions || []).length} retention exceptions</Text>
          </View>
        ))}

      <Text style={styles.section}>Privacy incidents</Text>
      <View style={styles.card}>
        <TextInput testID="dg-incident-type" value={itype} onChangeText={setItype} placeholder="Incident type (e.g. unauthorized access attempt)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
        <View style={styles.chipRow}>{["low", "medium", "high", "critical"].map((s) => <Pressable key={s} testID={`dg-sev-${s}`} style={[styles.chip, isev === s && styles.chipOn]} onPress={() => setIsev(s)}><Text style={[styles.chipText, isev === s && styles.chipTextOn]}>{s}</Text></Pressable>)}</View>
        <Pressable testID="dg-incident-create" disabled={busy} style={styles.primaryBtn} onPress={createIncident}><Text style={styles.primaryText}>Log incident</Text></Pressable>
      </View>
      {incidents.map((i) => (
        <View key={i.id} style={[styles.card, { borderLeftColor: SEV_COLOR[i.severity], borderLeftWidth: 3 }]}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rTitle}>{i.incident_type}</Text>
              <Text style={styles.rMeta}>{i.severity} · {i.affected_data_category || "n/a"} · {String(i.created_at || "").slice(0, 10)}</Text>
            </View>
            <View style={[styles.tag, { borderColor: ISTATUS_COLOR[i.status] }]}><Text style={[styles.tagText, { color: ISTATUS_COLOR[i.status] }]}>{i.status}</Text></View>
          </View>
          <View style={styles.actRow}>
            {i.status !== "investigating" && i.status !== "resolved" ? <Pressable testID={`dg-inc-invest-${i.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setIncidentStatus(i.id, "investigating")}><Text style={styles.smallBtnText}>Investigate</Text></Pressable> : null}
            {i.status !== "contained" && i.status !== "resolved" ? <Pressable testID={`dg-inc-contain-${i.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setIncidentStatus(i.id, "contained")}><Text style={styles.smallBtnText}>Contain</Text></Pressable> : null}
            {i.status !== "resolved" ? <Pressable testID={`dg-inc-resolve-${i.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setIncidentStatus(i.id, "resolved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Resolve</Text></Pressable> : null}
          </View>
        </View>
      ))}
      <Text style={styles.note}>Admins never browse private property data here. Sensitive access needs a logged support, safety, fraud or legal reason. Raw credentials and payment cards are never accessible.</Text>
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
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
