import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Health = { status: string; uptime_seconds: number; db_ok: boolean; db_latency_ms: number | null; error_rate_pct: number; error_rate_alert: boolean; services: { name: string; status: string; latency_ms?: number }[] };
type Metrics = { requests: number; errors: number; error_rate_pct: number; avg_latency_ms: number; p95_latency_ms: number; by_status: { bucket: string; count: number }[] };
type ErrRow = { id: string; at: string; method: string; path: string; status: number; latency_ms: number };
type Incident = { id: string; at: string; title: string; severity: string; status: string };

const STATUS_COLOR: Record<string, string> = { healthy: colors.success, degraded: colors.warning, critical: colors.error };
const SEV_COLOR: Record<string, string> = { low: colors.onSurfaceTertiary, medium: colors.warning, high: "#E67E22", critical: colors.error };

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function MonitoringModule() {
  const [health, setHealth] = useState<Health | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [topFailing, setTopFailing] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, m, e, inc] = await Promise.all([
        api<Health>("/admin/monitoring/health"), api<Metrics>("/admin/monitoring/metrics"),
        api<{ recent: ErrRow[]; top_failing: any[] }>("/admin/monitoring/errors"),
        api<{ incidents: Incident[] }>("/admin/monitoring/incidents?status=open"),
      ]);
      setHealth(h); setMetrics(m); setErrors(e.recent); setTopFailing(e.top_failing); setIncidents(inc.incidents);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logIncident = async () => {
    try { await api("/admin/monitoring/incidents", { method: "POST", body: { title: "Manual ops check", severity: "low", source: "ops" } }); load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
  };
  const resolve = async (id: string) => {
    try { await api(`/admin/monitoring/incidents/${id}/resolve`, { method: "POST" }); load(); } catch {}
  };

  if (loading || !health || !metrics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>DevOps & Monitoring</Text>
        <Pressable testID="mon-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={[styles.statusCard, { borderColor: STATUS_COLOR[health.status] }]}>
        <View style={[styles.dot, { backgroundColor: STATUS_COLOR[health.status] }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[health.status] }]}>{health.status.toUpperCase()}</Text>
          <Text style={styles.statusSub}>Uptime {fmtUptime(health.uptime_seconds)} · DB {health.db_latency_ms ?? "—"}ms · errors {health.error_rate_pct}%</Text>
        </View>
      </View>
      {health.error_rate_alert && (
        <View style={styles.alert}><MaterialCommunityIcons name="alert" size={16} color={colors.error} /><Text style={styles.alertText}>Error rate above {5}% — investigate recent errors.</Text></View>
      )}

      <Text style={styles.section}>Services</Text>
      {health.services.map((s) => (
        <View key={s.name} style={styles.svcRow}>
          <MaterialCommunityIcons name={s.status === "up" ? "check-circle" : "close-circle"} size={16} color={s.status === "up" ? colors.success : colors.error} />
          <Text style={styles.svcName}>{s.name}</Text>
          <Text style={styles.svcMeta}>{s.status}{s.latency_ms ? ` · ${s.latency_ms}ms` : ""}</Text>
        </View>
      ))}

      <Text style={styles.section}>Live metrics (since restart)</Text>
      <View style={styles.statRow}>
        <Stat label="Requests" value={String(metrics.requests)} />
        <Stat label="Errors" value={String(metrics.errors)} accent={metrics.errors > 0} />
        <Stat label="Err rate" value={`${metrics.error_rate_pct}%`} />
        <Stat label="Avg ms" value={String(metrics.avg_latency_ms)} />
        <Stat label="p95 ms" value={String(metrics.p95_latency_ms)} />
      </View>
      <View style={styles.badges}>
        {metrics.by_status.map((b) => (
          <View key={b.bucket} style={[styles.statusBadge, b.bucket >= "4xx" && { borderColor: colors.error + "66" }]}>
            <Text style={[styles.badgeText, b.bucket >= "4xx" && { color: colors.error }]}>{b.bucket}: {b.count}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Top failing endpoints</Text>
      {topFailing.length === 0 ? <Text style={styles.help}>No errors recorded. 🎉</Text> :
        topFailing.map((t, i) => (
          <View key={i} style={styles.errRow}><Text style={styles.errPath} numberOfLines={1}>{t.status} · {t.path}</Text><Text style={styles.errCount}>{t.count}</Text></View>
        ))}
      {errors.slice(0, 5).map((er) => (
        <Text key={er.id} style={styles.recentErr} numberOfLines={1}>{(er.at || "").slice(11, 19)} · {er.method} {er.path} → {er.status} ({er.latency_ms}ms)</Text>
      ))}

      <View style={styles.titleRow}>
        <Text style={styles.section}>Incidents ({incidents.length} open)</Text>
        <Pressable testID="mon-log-incident" style={styles.smallBtn} onPress={logIncident}><Text style={styles.smallBtnText}>+ Log</Text></Pressable>
      </View>
      {incidents.length === 0 ? <Text style={styles.help}>No open incidents.</Text> :
        incidents.map((inc) => (
          <View key={inc.id} testID="mon-incident-row" style={styles.incRow}>
            <View style={[styles.sevDot, { backgroundColor: SEV_COLOR[inc.severity] }]} />
            <View style={{ flex: 1 }}><Text style={styles.incTitle}>{inc.title}</Text><Text style={styles.incMeta}>{inc.severity} · {(inc.at || "").slice(0, 16).replace("T", " ")}</Text></View>
            <Pressable testID={`mon-resolve-${inc.id}`} style={styles.smallBtn} onPress={() => resolve(inc.id)}><Text style={styles.smallBtnText}>Resolve</Text></Pressable>
          </View>
        ))}

      <Text style={styles.note}>Note: auto-scaling & code rollback require hosting/infra control and are surfaced here as advisory thresholds. Connect Sentry/DataDog for deeper external tracing.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.error }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontFamily: font.display, fontSize: 18 },
  statusSub: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  alert: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.error + "18", borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.sm },
  alertText: { flex: 1, color: colors.error, fontFamily: font.medium, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  svcRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  svcName: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  svcMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textTransform: "capitalize" },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flex: 1, minWidth: 60, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 17 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  statusBadge: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11 },
  errRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  errPath: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs },
  errCount: { color: colors.error, fontFamily: font.bold, fontSize: type.sm, marginLeft: spacing.sm },
  recentErr: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, marginTop: 4 },
  incRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  incTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  incMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.xl },
});
