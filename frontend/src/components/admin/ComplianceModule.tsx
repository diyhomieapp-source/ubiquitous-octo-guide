import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const RSTATUS_COLOR: Record<string, string> = { active: "#27AE60", approved: "#2F80ED", draft: "#F2994A", superseded: "#888", archived: "#888" };

export function ComplianceModule() {
  const [dash, setDash] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, r, f] = await Promise.all([api<any>("/hi/admin/compliance/dashboard"), api<any>("/hi/admin/compliance/rules"), api<any>("/hi/admin/compliance/flags")]);
      setDash(d); setRules(r.rules || []); setFlags(f.flags || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleCat = async (category: string, enabled: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/compliance/categories", { method: "PUT", body: { category, enabled } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setRuleStatus = async (rl: any, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/compliance/rules/${rl.id}/status`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const resolveFlag = async (fid: string) => {
    setBusy(true);
    try { await api(`/hi/admin/compliance/flags/${fid}/resolve`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't resolve", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Permit & Code</Text>
        <Pressable testID="comp-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Assessments" value={dash.total_assessments} />
        <Stat label="Rules" value={rules.length} />
        <Stat label="Expired" value={dash.expired_rules} accent={dash.expired_rules > 0} />
        <Stat label="Flags" value={dash.open_flags} accent={dash.open_flags > 0} />
      </View>

      <Text style={styles.section}>Assessments by level</Text>
      <View style={styles.card}>
        {Object.entries(dash.assessments_by_level).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Categories</Text>
      <View style={styles.card}>
        {Object.entries(dash.settings.categories_enabled).map(([c, en]) => (
          <View key={c} style={styles.rowBetween}><Text style={styles.k}>{c.replace(/_/g, " ")}</Text><Switch value={en as boolean} onValueChange={(v) => toggleCat(c, v)} trackColor={{ true: colors.brandPrimary }} /></View>
        ))}
      </View>

      <Text style={styles.section}>Rules ({rules.length})</Text>
      {rules.map((rl) => (
        <View key={rl.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rTitle}>{rl.title}</Text>
              <Text style={styles.rMeta}>{rl.project_category} · {rl.rule_type.replace(/_/g, " ")} · {rl.source_date || "no date"}</Text>
            </View>
            <View style={[styles.tag, { borderColor: RSTATUS_COLOR[rl.status] }]}><Text style={[styles.tagText, { color: RSTATUS_COLOR[rl.status] }]}>{rl.status}</Text></View>
          </View>
          <View style={styles.actRow}>
            {rl.status !== "active" ? <Pressable testID={`rule-active-${rl.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setRuleStatus(rl, "active")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Activate</Text></Pressable> : null}
            {rl.status === "active" ? <Pressable testID={`rule-super-${rl.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setRuleStatus(rl, "superseded")}><Text style={styles.smallBtnText}>Supersede</Text></Pressable> : null}
            <Pressable testID={`rule-archive-${rl.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setRuleStatus(rl, "archived")}><Text style={styles.smallBtnText}>Archive</Text></Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>Reported guidance ({flags.length})</Text>
      {flags.length === 0 ? <Text style={styles.note}>No reports.</Text> :
        flags.map((f) => (
          <View key={f.id} style={styles.card}>
            <Text style={styles.rMeta}>{f.reason}</Text>
            <Pressable testID={`comp-flag-${f.id}`} disabled={busy} style={[styles.smallBtn, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={() => resolveFlag(f.id)}><Text style={styles.smallBtnText}>Resolve</Text></Pressable>
          </View>
        ))}
      <Text style={styles.note}>Rules need a source date before going active. Expired/undated rules are never shown as current requirements. DIYhomie never guarantees compliance.</Text>
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
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
