import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Ev = { id: string; at: string; event: string; category: string; method: string; path: string; risk_level: string; actor_type: string; actor_email: string | null; status_code: number | null };
type Alert2 = { id: string; at: string; kind: string; detail: string; risk_level: string; actor_email: string | null; status: string };
type KC = { key: string; count: number };
type Analytics = { total_events: number; by_category: KC[]; by_risk: KC[]; by_actor_type: KC[]; top_actors: { actor_email: string | null; actor_id: string; count: number }[]; open_alerts: number };

const RISK_COLOR: Record<string, string> = { high: colors.error, medium: colors.warning, low: colors.onSurfaceTertiary };
type Tab = "log" | "analytics" | "alerts";

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`;
}

export function AuditModule() {
  const [tab, setTab] = useState<Tab>("log");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Ev[]>([]);
  const [total, setTotal] = useState(0);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [alerts, setAlerts] = useState<Alert2[]>([]);
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    const params = new URLSearchParams({ limit: "80" });
    if (q.trim()) params.set("q", q.trim());
    if (risk) params.set("risk", risk);
    if (category) params.set("category", category);
    try { const r = await api<{ total: number; events: Ev[] }>(`/admin/audit?${params.toString()}`); setEvents(r.events); setTotal(r.total); } catch {}
  }, [q, risk, category]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, al] = await Promise.all([
        api<Analytics>("/admin/audit/analytics"),
        api<{ alerts: Alert2[] }>("/admin/audit/alerts?status=open"),
      ]);
      setAnalytics(a); setAlerts(al.alerts);
      await loadLog();
    } catch {} finally { setLoading(false); }
  }, [loadLog]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resolveAlert = async (id: string) => {
    try { await api(`/admin/audit/alerts/${id}/resolve`, { method: "POST", body: { note: "Reviewed from workstation" } }); load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
  };

  if (loading || !analytics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const maxCat = Math.max(1, ...analytics.by_category.map((c) => c.count));

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.h1}>Audit & Transparency</Text>
      <Text style={styles.sub}>Every user, admin, partner & API action — searchable, sliceable & alertable.</Text>

      <View style={styles.tabs}>
        {(["log", "analytics", "alerts"] as Tab[]).map((t) => (
          <Pressable key={t} testID={`audit-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === "log" ? "Event Log" : t === "analytics" ? "Analytics" : `Alerts${analytics.open_alerts ? ` (${analytics.open_alerts})` : ""}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "log" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <View style={styles.searchRow}>
            <TextInput testID="audit-search" style={styles.search} value={q} onChangeText={setQ} placeholder="Search path, email or event…" placeholderTextColor={colors.onSurfaceTertiary} onSubmitEditing={loadLog} />
            <Pressable testID="audit-search-btn" style={styles.searchBtn} onPress={loadLog}><MaterialCommunityIcons name="magnify" size={20} color={colors.onBrandPrimary} /></Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            {["high", "medium", "low"].map((r) => (
              <Pressable key={r} testID={`audit-filter-${r}`} style={[styles.chip, risk === r && styles.chipOn]} onPress={() => { setRisk(risk === r ? null : r); setTimeout(loadLog, 0); }}>
                <Text style={[styles.chipText, risk === r && styles.chipTextOn]}>{r} risk</Text>
              </Pressable>
            ))}
            {analytics.by_category.slice(0, 8).map((c) => (
              <Pressable key={c.key} style={[styles.chip, category === c.key && styles.chipOn]} onPress={() => { setCategory(category === c.key ? null : c.key); setTimeout(loadLog, 0); }}>
                <Text style={[styles.chipText, category === c.key && styles.chipTextOn]}>{c.key}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.resultCount}>{total} events</Text>
          {events.map((e) => (
            <View key={e.id} testID="audit-event-row" style={styles.evRow}>
              <View style={[styles.dot, { backgroundColor: RISK_COLOR[e.risk_level] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.evTitle} numberOfLines={1}>{e.method} {e.path || e.event}</Text>
                <Text style={styles.evMeta}>{e.actor_type}{e.actor_email ? ` · ${e.actor_email}` : ""} · {e.category} · {ago(e.at)}</Text>
              </View>
              {e.status_code ? <Text style={[styles.status, { color: e.status_code >= 400 ? colors.error : colors.success }]}>{e.status_code}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}

      {tab === "analytics" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
          <View style={styles.statRow}>
            <Stat label="Total events" value={String(analytics.total_events)} />
            <Stat label="Open alerts" value={String(analytics.open_alerts)} accent={analytics.open_alerts > 0} />
            <Stat label="Categories" value={String(analytics.by_category.length)} />
          </View>
          <Text style={styles.section}>By category</Text>
          {analytics.by_category.map((c) => (
            <View key={c.key} style={styles.barRow}>
              <Text style={styles.barLabel}>{c.key}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(c.count / maxCat * 100)}%` }]} /></View>
              <Text style={styles.barCount}>{c.count}</Text>
            </View>
          ))}
          <Text style={styles.section}>By risk</Text>
          <View style={styles.statRow}>
            {analytics.by_risk.map((r) => (
              <View key={r.key} style={[styles.stat, { borderColor: RISK_COLOR[r.key] }]}>
                <Text style={[styles.statVal, { color: RISK_COLOR[r.key] }]}>{r.count}</Text>
                <Text style={styles.statLabel}>{r.key}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.section}>Most active accounts</Text>
          {analytics.top_actors.map((a, i) => (
            <View key={i} style={styles.evRow}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Text style={styles.evTitle} numberOfLines={1}>{a.actor_email || a.actor_id?.slice(0, 8) || "system"}</Text>
              <Text style={styles.barCount}>{a.count}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === "alerts" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
          {alerts.length === 0 ? (
            <View style={styles.empty}><MaterialCommunityIcons name="shield-check" size={40} color={colors.success} /><Text style={styles.emptyText}>No open alerts. All clear.</Text></View>
          ) : alerts.map((a) => (
            <View key={a.id} testID="audit-alert-row" style={styles.alertCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <MaterialCommunityIcons name="alert-outline" size={18} color={RISK_COLOR[a.risk_level]} />
                <Text style={[styles.alertKind, { color: RISK_COLOR[a.risk_level] }]}>{a.kind}</Text>
                <Text style={styles.alertTime}>{ago(a.at)}</Text>
              </View>
              <Text style={styles.alertDetail}>{a.detail}</Text>
              {a.actor_email ? <Text style={styles.alertActor}>{a.actor_email}</Text> : null}
              <Pressable testID={`audit-resolve-${a.id}`} style={styles.resolveBtn} onPress={() => resolveAlert(a.id)}>
                <Text style={styles.resolveText}>Mark resolved</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={[styles.stat, accent && { borderColor: colors.error }]}><Text style={[styles.statVal, accent && { color: colors.error }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  tabTextOn: { color: colors.onSurface, fontFamily: font.bold },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  search: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  searchBtn: { width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  resultCount: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginVertical: spacing.sm },
  evRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  evTitle: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  evMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  status: { fontFamily: font.bold, fontSize: type.xs },
  rank: { width: 20, color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 90, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2, textTransform: "capitalize" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  barLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, width: 100, textTransform: "capitalize" },
  track: { flex: 1, height: 16, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 16, borderRadius: radius.sm, backgroundColor: colors.brandPrimary },
  barCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, width: 44, textAlign: "right" },
  empty: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  alertCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  alertKind: { fontFamily: font.bold, fontSize: type.base, textTransform: "capitalize" },
  alertTime: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginLeft: "auto" },
  alertDetail: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  alertActor: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  resolveBtn: { alignSelf: "flex-start", marginTop: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  resolveText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
