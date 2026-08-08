import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const SEV_COLOR: Record<string, string> = { critical: "#EB5757", high: "#FF6A00", medium: "#2F80ED", low: "#888" };

export function AnalyticsModule() {
  const [sum, setSum] = useState<any>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [relVer, setRelVer] = useState("");
  const [incArea, setIncArea] = useState("");
  const [incSev, setIncSev] = useState("high");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, f, i] = await Promise.all([
        api("/hi/admin/analytics/summary"),
        api<{ flags: any[] }>("/hi/admin/analytics/flags"),
        api<{ incidents: any[] }>("/hi/admin/analytics/incidents"),
      ]);
      setSum(s); setFlags(f.flags); setIncidents(i.incidents);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleFlag = async (key: string) => { try { await api(`/hi/admin/analytics/flags/${key}/toggle`, { method: "POST" }); load(); } catch {} };
  const createRelease = async () => { if (!relVer.trim()) return; try { await api("/hi/admin/analytics/releases", { method: "POST", body: { version: relVer.trim() } }); setRelVer(""); load(); } catch {} };
  const rollback = async (id: string) => { try { await api(`/hi/admin/analytics/releases/${id}/rollback`, { method: "POST" }); load(); } catch {} };
  const createIncident = async () => { if (!incArea.trim()) return; try { await api("/hi/admin/analytics/incidents", { method: "POST", body: { feature_area: incArea.trim(), severity: incSev } }); setIncArea(""); load(); } catch {} };
  const resolveIncident = async (id: string) => { try { await api(`/hi/admin/analytics/incidents/${id}`, { method: "PUT", body: { status: "resolved" } }); load(); } catch {} };

  const open = (url: string) => { try { Linking.openURL(url); } catch {} };

  if (loading || !sum) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  const stats = [
    { label: "Daily active users", value: sum.usage.dau, icon: "account-clock" },
    { label: "New accounts (7d)", value: sum.usage.new_accounts_7d, icon: "account-plus" },
    { label: "Onboarding complete", value: `${sum.usage.onboarding_completion_pct}%`, icon: "flag-checkered" },
    { label: "Projects started", value: sum.projects.started, icon: "clipboard-list" },
    { label: "Projects completed", value: sum.projects.completed, icon: "clipboard-check" },
    { label: "Maintenance done", value: sum.maintenance.completed, icon: "wrench-check" },
    { label: "Document uploads", value: sum.documents.uploads, icon: "file-upload" },
    { label: "Paid subscribers", value: sum.subscriptions.paid_users, icon: "credit-card-check" },
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.modHead}>
        <Text style={styles.modTitle}>Product Analytics</Text>
        <Pressable testID="admin-refresh" onPress={load} hitSlop={8}><MaterialCommunityIcons name="refresh" size={22} color={colors.onSurface} /></Pressable>
      </View>

      <View style={styles.intRow}>
        <View style={[styles.intPill, { borderColor: sum.integrations.posthog ? "#27AE60" : colors.border }]}>
          <MaterialCommunityIcons name="chart-timeline-variant" size={16} color={sum.integrations.posthog ? "#27AE60" : colors.onSurfaceTertiary} />
          <Text style={styles.intText}>PostHog {sum.integrations.posthog ? "connected" : "not connected"}</Text>
        </View>
        <View style={[styles.intPill, { borderColor: sum.integrations.sentry ? "#27AE60" : colors.border }]}>
          <MaterialCommunityIcons name="bug-outline" size={16} color={sum.integrations.sentry ? "#27AE60" : colors.onSurfaceTertiary} />
          <Text style={styles.intText}>Sentry {sum.integrations.sentry ? "connected" : "not connected"}</Text>
        </View>
      </View>
      <Text style={styles.hint}>These metrics are a health snapshot. Open PostHog / Sentry for full funnels, cohorts and stack traces.</Text>
      <View style={styles.linkRow}>
        <Pressable testID="open-posthog" style={styles.linkBtn} onPress={() => open("https://us.posthog.com")}><MaterialCommunityIcons name="open-in-new" size={14} color={colors.brandPrimary} /><Text style={styles.linkText}>Open PostHog</Text></Pressable>
        <Pressable testID="open-sentry" style={styles.linkBtn} onPress={() => open("https://sentry.io")}><MaterialCommunityIcons name="open-in-new" size={14} color={colors.brandPrimary} /><Text style={styles.linkText}>Open Sentry</Text></Pressable>
      </View>

      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.statCard}>
            <MaterialCommunityIcons name={s.icon as any} size={20} color={colors.brandPrimary} />
            <Text style={styles.statValue}>{s.value ?? 0}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Feature flags</Text>
      {flags.map((f) => (
        <View key={f.feature_key} style={styles.flagRow} testID={`flag-${f.feature_key}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.flagKey}>{f.feature_key}</Text>
            <Text style={styles.flagDesc}>{f.description} · {f.owner} · {f.rollout_status}</Text>
          </View>
          <Pressable testID={`flag-toggle-${f.feature_key}`} style={[styles.flagToggle, f.default_value && styles.flagOn]} onPress={() => toggleFlag(f.feature_key)}>
            <Text style={[styles.flagToggleText, f.default_value && { color: "#fff" }]}>{f.default_value ? "ON" : "OFF"}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>Releases &amp; health</Text>
      <View style={styles.inlineForm}>
        <TextInput testID="release-version" style={styles.input} value={relVer} onChangeText={setRelVer} placeholder="e.g. 1.1.0" placeholderTextColor={colors.onSurfaceTertiary} />
        <Pressable testID="release-create" style={styles.addBtn} onPress={createRelease}><Text style={styles.addBtnText}>Tag release</Text></Pressable>
      </View>
      {(sum.releases || []).map((r: any) => (
        <View key={r.id} style={styles.relRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.relVer}>{r.version} <Text style={styles.relEnv}>· {r.environment}</Text></Text>
            <Text style={styles.relMeta}>{r.status} · {(r.deployed_at || "").slice(0, 10)}</Text>
          </View>
          {r.status === "active" && <Pressable testID={`rollback-${r.id}`} style={styles.rollbackBtn} onPress={() => rollback(r.id)}><Text style={styles.rollbackText}>Roll back</Text></Pressable>}
        </View>
      ))}

      <Text style={styles.section}>Top technical errors</Text>
      {(sum.top_errors || []).length === 0 ? <Text style={styles.empty}>No open incidents 🎉</Text> :
        sum.top_errors.map((e: any) => (
          <View key={e.label} style={styles.errRow}><Text style={styles.errLabel}>{e.label}</Text><Text style={styles.errCount}>{e.count}</Text></View>
        ))}

      <Text style={styles.section}>Log an incident (link to a Sentry issue)</Text>
      <View style={styles.inlineForm}>
        <TextInput testID="inc-area" style={[styles.input, { flex: 1 }]} value={incArea} onChangeText={setIncArea} placeholder="feature area (e.g. projects)" placeholderTextColor={colors.onSurfaceTertiary} />
      </View>
      <View style={styles.sevRow}>
        {["critical", "high", "medium", "low"].map((s) => (
          <Pressable key={s} testID={`sev-${s}`} style={[styles.sevChip, incSev === s && { backgroundColor: SEV_COLOR[s], borderColor: SEV_COLOR[s] }]} onPress={() => setIncSev(s)}>
            <Text style={[styles.sevText, incSev === s && { color: "#fff" }]}>{s}</Text>
          </Pressable>
        ))}
        <Pressable testID="inc-create" style={styles.addBtn} onPress={createIncident}><Text style={styles.addBtnText}>Log</Text></Pressable>
      </View>
      {incidents.map((i) => (
        <View key={i.id} style={styles.errRow} testID={`incident-${i.id}`}>
          <View style={[styles.sevDot, { backgroundColor: SEV_COLOR[i.severity] || "#888" }]} />
          <Text style={styles.errLabel}>{i.feature_area} · {i.status}</Text>
          {i.status !== "resolved" && <Pressable testID={`inc-resolve-${i.id}`} onPress={() => resolveIncident(i.id)}><Text style={styles.resolveText}>Resolve</Text></Pressable>}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"], maxWidth: 900, width: "100%", alignSelf: "center" },
  center: { padding: 60, alignItems: "center" },
  modHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 0.5 },
  intRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  intPill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  intText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  linkRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.lg },
  statCard: { flexGrow: 1, minWidth: 140, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 28 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  flagRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  flagKey: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  flagDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  flagToggle: { minWidth: 52, alignItems: "center", borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  flagOn: { backgroundColor: "#27AE60", borderColor: "#27AE60" },
  flagToggleText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  inlineForm: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  relRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  relVer: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  relEnv: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  relMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  rollbackBtn: { borderColor: "#EB5757", borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  rollbackText: { color: "#EB5757", fontFamily: font.bold, fontSize: type.sm },
  errRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  errLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  errCount: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  sevRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm, alignItems: "center" },
  sevChip: { borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  sevText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  sevDot: { width: 10, height: 10, borderRadius: 5 },
  resolveText: { color: "#27AE60", fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
});
