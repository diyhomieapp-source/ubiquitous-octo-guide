import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const TSTATUS_COLOR: Record<string, string> = { active: "#27AE60", approved: "#2F80ED", draft: "#F2994A", archived: "#888" };

export function NotifOrchestrationModule() {
  const [dash, setDash] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([api<any>("/hi/admin/notifications/dashboard"), api<any>("/hi/admin/notifications/templates")]);
      setDash(d); setTemplates(t.templates || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleCat = async (category: string, enabled: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/notifications/categories", { method: "PUT", body: { category, enabled } }); await load(); }
    catch (e: any) { Alert.alert("Can't change", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const togglePause = async (v: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/notifications/settings", { method: "PUT", body: { pause_nonessential: v } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setStatus = async (t: any, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/notifications/templates/${t.id}/status`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const s = dash.settings;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Notification Orchestration</Text>
        <Pressable testID="notiforch-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Deliveries" value={dash.total_deliveries} />
        <Stat label="Open rate %" value={dash.open_rate} />
        <Stat label="Failed" value={dash.failed} accent={dash.failed > 0} />
        <Stat label="Templates" value={templates.length} />
      </View>

      <Text style={styles.section}>Delivery health</Text>
      <View style={styles.card}>
        {Object.entries(dash.by_status).filter(([, v]) => (v as number) > 0).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v as number}</Text></View>)}
        {Object.keys(dash.suppressions || {}).length ? <Text style={styles.sub}>Suppressions</Text> : null}
        {Object.entries(dash.suppressions || {}).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Category controls</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}><Text style={[styles.k, { color: "#F2994A" }]}>Pause non-essential comms</Text><Switch testID="notiforch-pause" value={!!s.pause_nonessential} onValueChange={togglePause} trackColor={{ true: "#F2994A" }} /></View>
        {Object.entries(s.categories_enabled).map(([c, en]) => (
          <View key={c} style={styles.rowBetween}>
            <Text style={styles.k}>{c}</Text>
            <Switch value={en as boolean} disabled={c === "safety"} onValueChange={(v) => toggleCat(c, v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
        ))}
        <Text style={styles.note}>Daily cap {s.daily_cap_normal} · quiet hours {s.quiet_hours_start}:00–{s.quiet_hours_end}:00. Safety can't be disabled.</Text>
      </View>

      <Text style={styles.section}>Templates ({templates.length})</Text>
      {templates.map((t) => (
        <View key={t.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tKey}>{t.template_key} <Text style={styles.tVer}>v{t.version}</Text></Text>
              <Text style={styles.tMeta}>{t.category}{t.requires_approval ? " · approval required" : ""}</Text>
              <Text style={styles.tTitle} numberOfLines={1}>{t.title_template}</Text>
            </View>
            <View style={[styles.tag, { borderColor: TSTATUS_COLOR[t.status] }]}><Text style={[styles.tagText, { color: TSTATUS_COLOR[t.status] }]}>{t.status}</Text></View>
          </View>
          <View style={styles.actRow}>
            {t.requires_approval && t.status === "draft" ? <Pressable testID={`tmpl-approve-${t.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#2F80ED" }]} onPress={() => setStatus(t, "approved")}><Text style={[styles.smallBtnText, { color: "#2F80ED" }]}>Approve</Text></Pressable> : null}
            {t.status !== "active" ? <Pressable testID={`tmpl-activate-${t.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setStatus(t, "active")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Activate</Text></Pressable> : null}
            {t.status !== "archived" ? <Pressable testID={`tmpl-archive-${t.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setStatus(t, "archived")}><Text style={styles.smallBtnText}>Archive</Text></Pressable> : null}
          </View>
        </View>
      ))}
      <Text style={styles.note}>Safety, billing & marketing templates need approval before going active. AI may draft variations but can't auto-send marketing/public messages.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
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
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs, marginTop: spacing.sm, textTransform: "uppercase" },
  tKey: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  tVer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs },
  tMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  tTitle: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
