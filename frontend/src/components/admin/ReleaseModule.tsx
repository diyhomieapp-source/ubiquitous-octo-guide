import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const HEALTH_COLOR: Record<string, string> = { healthy: "#27AE60", watch: "#F2994A", degraded: "#EB5757", critical: "#EB5757" };
const REL_COLOR: Record<string, string> = { planned: "#888", deployed: "#2F80ED", paused: "#F2994A", rolled_back: "#EB5757", completed: "#27AE60" };

export function ReleaseModule() {
  const [tab, setTab] = useState<"releases" | "incidents" | "flags">("releases");
  const [dash, setDash] = useState<any>(null);
  const [releases, setReleases] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, r, i, f] = await Promise.all([
        api<any>("/hi/admin/release/dashboard"), api<any>("/hi/admin/release/releases"),
        api<any>("/hi/admin/release/incidents"), api<any>("/hi/admin/release/flags"),
      ]);
      setDash(d); setReleases(r.releases || []); setIncidents(i.incidents || []); setFlags(f.flags || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createRelease = async () => {
    if (!ver.trim()) { Alert.alert("Version needed", "Enter a version."); return; }
    setBusy(true);
    try { await api("/hi/admin/release/releases", { method: "POST", body: { version: ver, release_type: "backend", summary: "New release", owner: "admin", risk_level: "medium", rollback_plan: "Disable feature flag / revert deploy" } }); setVer(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setStatus = async (rid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/release/releases/${rid}`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Blocked", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setIncStatus = async (iid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/admin/release/incidents/${iid}`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}><Text style={styles.h1}>Release & QA</Text><Pressable testID="rel-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable></View>
      <View style={styles.statRow}>
        <Stat label="CUJ passing" value={`${dash.critical_journeys.passing}/${dash.critical_journeys.total}`} accent={dash.critical_journeys.passing < dash.critical_journeys.total} />
        <Stat label="AI fails" value={dash.ai_eval.failing} accent={dash.ai_eval.failing > 0} />
        <Stat label="Open incidents" value={dash.open_incidents} accent={dash.open_incidents > 0} />
        <Stat label="Flags" value={dash.active_flags} />
      </View>

      <View style={styles.tabs}>{(["releases", "incidents", "flags"] as const).map((t) => <Pressable key={t} testID={`rel-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}><Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text></Pressable>)}</View>

      {tab === "releases" && (
        <>
          <View style={styles.addRow}>
            <TextInput testID="rel-version" value={ver} onChangeText={setVer} placeholder="Version e.g. 1.3.0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Pressable testID="rel-create" disabled={busy} style={styles.addBtn} onPress={createRelease}><Text style={styles.addBtnText}>Add</Text></Pressable>
          </View>
          {releases.map((r) => (
            <View key={r.id} style={styles.card}>
              <View style={styles.labelRow}><Text style={styles.rTitle}>{r.version} · {r.release_type}</Text><View style={[styles.tag, { borderColor: REL_COLOR[r.status] }]}><Text style={[styles.tagText, { color: REL_COLOR[r.status] }]}>{r.status}</Text></View></View>
              <Text style={styles.rMeta}>{r.summary} · risk {r.risk_level} · {r.owner}</Text>
              <View style={styles.actRow}>
                {r.status === "planned" ? <Pressable testID={`rel-deploy-${r.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setStatus(r.id, "deployed")}><Text style={styles.smallBtnText}>Deploy</Text></Pressable> : null}
                {r.status === "deployed" ? <Pressable testID={`rel-complete-${r.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setStatus(r.id, "completed")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Complete</Text></Pressable> : null}
                {r.status !== "rolled_back" && r.status !== "completed" ? <Pressable testID={`rel-rollback-${r.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => setStatus(r.id, "rolled_back")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Roll back</Text></Pressable> : null}
              </View>
            </View>
          ))}
        </>
      )}

      {tab === "incidents" && (incidents.length === 0 ? <Text style={styles.note}>No incidents logged.</Text> : incidents.map((i) => (
        <View key={i.id} style={[styles.card, { borderLeftColor: HEALTH_COLOR[i.severity === "critical" ? "critical" : "watch"], borderLeftWidth: 3 }]}>
          <Text style={styles.rTitle}>{i.title}</Text>
          <Text style={styles.rMeta}>{i.severity} · {i.category} · {i.status}</Text>
          <View style={styles.actRow}>
            {i.status !== "resolved" ? <Pressable testID={`rel-inc-resolve-${i.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setIncStatus(i.id, "resolved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Resolve</Text></Pressable> : null}
            {i.status === "detected" ? <Pressable testID={`rel-inc-invest-${i.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setIncStatus(i.id, "investigating")}><Text style={styles.smallBtnText}>Investigate</Text></Pressable> : null}
          </View>
        </View>
      )))}

      {tab === "flags" && (flags.length === 0 ? <Text style={styles.note}>No feature flags. Safety flows can't be gated behind experimental flags.</Text> : flags.map((f) => (
        <View key={f.id} style={styles.card}><Text style={styles.rTitle}>{f.key}</Text><Text style={styles.rMeta}>{f.description} · {f.rollout_stage} · default {f.default_state ? "on" : "off"}</Text></View>
      )))}
      <Text style={styles.note}>A release can't complete while critical journeys or AI safety cases fail, or without a rollback plan.</Text>
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
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
