import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const PSTATUS_COLOR: Record<string, string> = { active: "#27AE60", pending: "#F2994A", suspended: "#EB5757" };

export function ProWorkspaceModule() {
  const [dash, setDash] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([api<any>("/hi/admin/pro/dashboard"), api<any>("/hi/admin/pro/profiles")]);
      setDash(d); setProfiles(p.profiles || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setSetting = async (key: string, value: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/pro/settings", { method: "PUT", body: { [key]: value } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setProfileStatus = async (pid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/pro/profiles/${pid}/status`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const s = dash.settings || {};

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Pro Workspace</Text>
        <Pressable testID="pro-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Projects" value={dash.total_projects} />
        <Stat label="Active pros" value={dash.profiles_by_status?.active || 0} />
        <Stat label="Pending" value={dash.profiles_by_status?.pending || 0} accent={(dash.profiles_by_status?.pending || 0) > 0} />
        <Stat label="Open QA" value={dash.open_qa_issues} accent={dash.open_qa_issues > 0} />
      </View>
      <View style={styles.statRow}>
        <Stat label="Deliverables" value={dash.deliverables} />
        <Stat label="Orgs" value={dash.organizations} />
      </View>

      <Text style={styles.section}>Settings</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.k}>Feature enabled</Text>
            <Text style={styles.hint}>Turns the entire professional workspace on or off for all users.</Text>
          </View>
          <Switch testID="pro-toggle-enabled" value={!!s.feature_enabled} onValueChange={(v) => setSetting("feature_enabled", v)} trackColor={{ true: colors.brandPrimary }} disabled={busy} />
        </View>
        <View style={[styles.rowBetween, { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm, marginTop: spacing.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.k}>Auto-approve enrollment</Text>
            <Text style={styles.hint}>When off, new professionals stay pending until you approve them below.</Text>
          </View>
          <Switch testID="pro-toggle-approve" value={!!s.auto_approve} onValueChange={(v) => setSetting("auto_approve", v)} trackColor={{ true: colors.brandPrimary }} disabled={busy} />
        </View>
      </View>

      <Text style={styles.section}>Projects by status</Text>
      <View style={styles.card}>
        {Object.entries(dash.projects_by_status || {}).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Professionals ({profiles.length})</Text>
      {profiles.length === 0 ? <Text style={styles.note}>No professionals enrolled yet.</Text> :
        profiles.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rTitle}>{(p.professional_role || "professional").replace(/_/g, " ")}</Text>
                <Text style={styles.rMeta}>{p.organization_id ? "Org member" : "Independent"} · {p.created_at?.slice(0, 10)}</Text>
              </View>
              <View style={[styles.tag, { borderColor: PSTATUS_COLOR[p.status] || "#888" }]}><Text style={[styles.tagText, { color: PSTATUS_COLOR[p.status] || "#888" }]}>{p.status}</Text></View>
            </View>
            <View style={styles.actRow}>
              {p.status !== "active" ? <Pressable testID={`pro-approve-${p.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setProfileStatus(p.id, "active")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Approve</Text></Pressable> : null}
              {p.status !== "suspended" ? <Pressable testID={`pro-suspend-${p.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => setProfileStatus(p.id, "suspended")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Suspend</Text></Pressable> : null}
              {p.status === "suspended" ? <Pressable testID={`pro-reinstate-${p.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setProfileStatus(p.id, "pending")}><Text style={styles.smallBtnText}>Set pending</Text></Pressable> : null}
            </View>
          </View>
        ))}
      <Text style={styles.note}>Professional client data is private by default. QA flags data quality only — it never certifies survey-grade or permit-ready accuracy; the professional makes the final call.</Text>
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
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
