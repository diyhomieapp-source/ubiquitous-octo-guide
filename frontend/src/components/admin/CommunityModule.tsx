import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function CommunityModule() {
  const [tab, setTab] = useState<"queue" | "reports" | "settings">("queue");
  const [dash, setDash] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q, r] = await Promise.all([
        api<any>("/hi/admin/community/dashboard"), api<any>("/hi/admin/community/queue"), api<any>("/hi/admin/community/reports?status=open"),
      ]);
      setDash(d); setQueue(q.queue || []); setReports(r.reports || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (cid: string, decision: string) => {
    setBusy(true);
    try { await api(`/hi/admin/community/content/${cid}/decision`, { method: "POST", body: { decision } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const resolveReport = async (rid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/community/reports/${rid}/resolve`, { method: "POST", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setSetting = async (key: string, value: any) => {
    setBusy(true);
    try { await api("/hi/admin/community/settings", { method: "PUT", body: { [key]: value } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const s = dash.settings || {};

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Community</Text>
        <Pressable testID="cm-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Queue" value={dash.queue_size} accent={dash.queue_size > 0} />
        <Stat label="Enhanced" value={dash.enhanced_review} accent={dash.enhanced_review > 0} />
        <Stat label="Reports" value={dash.open_reports} accent={dash.open_reports > 0} />
        <Stat label="Published" value={dash.approved_total} />
      </View>

      <View style={styles.tabs}>
        {(["queue", "reports", "settings"] as const).map((t) => <Pressable key={t} testID={`cm-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}><Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text></Pressable>)}
      </View>

      {tab === "queue" && (queue.length === 0 ? <Text style={styles.note}>Moderation queue is empty.</Text> :
        queue.map((c) => (
          <View key={c.id} style={[styles.card, c.safety_classification === "high_risk" && { borderLeftColor: "#EB5757", borderLeftWidth: 3 }]}>
            <View style={styles.labelRow}><Text style={styles.cat}>{c.category} · {c.content_type.replace("Community", "")}</Text><Text style={[styles.classTag, c.safety_classification === "high_risk" && { color: "#EB5757" }]}>{c.safety_classification}</Text></View>
            <Text style={styles.rTitle}>{c.title}</Text>
            <Text style={styles.rBody} numberOfLines={4}>{c.body}</Text>
            {(c.pre_check_flags || []).length ? <Text style={styles.flags}>flags: {(c.pre_check_flags || []).join(", ")}</Text> : null}
            <View style={styles.actRow}>
              <Pressable testID={`cm-approve-${c.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => decide(c.id, "approve")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Approve</Text></Pressable>
              <Pressable testID={`cm-changes-${c.id}`} disabled={busy} style={styles.smallBtn} onPress={() => decide(c.id, "request_changes")}><Text style={styles.smallBtnText}>Request changes</Text></Pressable>
              <Pressable testID={`cm-reject-${c.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => decide(c.id, "reject")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Reject</Text></Pressable>
            </View>
          </View>
        )))}

      {tab === "reports" && (reports.length === 0 ? <Text style={styles.note}>No open reports.</Text> :
        reports.map((rp) => (
          <View key={rp.id} style={styles.card}>
            <Text style={styles.rTitle}>{rp.content_title}</Text>
            <Text style={styles.rBody}>Reason: {rp.report_reason}{rp.description ? ` — ${rp.description}` : ""}</Text>
            <Text style={styles.cat}>content status: {rp.content_status || "n/a"}</Text>
            <View style={styles.actRow}>
              <Pressable testID={`cm-report-remove-${rp.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => decide(rp.community_content_id, "remove")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Remove content</Text></Pressable>
              <Pressable testID={`cm-report-resolve-${rp.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => resolveReport(rp.id, "resolved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Resolve</Text></Pressable>
              <Pressable testID={`cm-report-dismiss-${rp.id}`} disabled={busy} style={styles.smallBtn} onPress={() => resolveReport(rp.id, "dismissed")}><Text style={styles.smallBtnText}>Dismiss</Text></Pressable>
            </View>
          </View>
        )))}

      {tab === "settings" && (
        <View style={styles.card}>
          <Row label="Pause all community publishing" value={!!s.publishing_paused} onToggle={(v: boolean) => setSetting("publishing_paused", v)} busy={busy} tid="cm-toggle-pause" />
          <Row label="Allow comments in high-risk categories" value={!!s.comments_in_high_risk_enabled} onToggle={(v: boolean) => setSetting("comments_in_high_risk_enabled", v)} busy={busy} tid="cm-toggle-comments" />
          <Text style={styles.subLabel}>Enhanced-review categories</Text>
          <Text style={styles.rBody}>{(s.high_risk_categories || []).join(", ")}</Text>
          <Text style={styles.subLabel}>Enabled content types</Text>
          <Text style={styles.rBody}>{(s.enabled_content_types || []).map((t: string) => t.replace("Community", "")).join(", ")}</Text>
        </View>
      )}
      <Text style={styles.note}>Every decision is audit-logged. Automated checks flag risky content but never auto-publish high-risk posts.</Text>
    </ScrollView>
  );
}

function Row({ label, value, onToggle, busy, tid }: any) {
  return <View style={styles.rowBetween}><Text style={styles.k}>{label}</Text><Switch testID={tid} value={value} disabled={busy} onValueChange={onToggle} trackColor={{ true: colors.brandPrimary }} /></View>;
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
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cat: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  classTag: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 4 },
  rBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 18 },
  flags: { color: "#F2994A", fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, flex: 1, paddingRight: spacing.sm },
  subLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xs, marginTop: spacing.md, textTransform: "uppercase" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
