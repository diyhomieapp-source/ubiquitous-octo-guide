import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { HomieFace } from "@/src/components/HomieFace";

const STATUS_COLOR: Record<string, string> = { Urgent: "#EB5757", "Needs Attention": "#F2994A", Upcoming: "#2F80ED", Suggested: "#9B51E0", Complete: "#27AE60" };
const TYPE_ICON: Record<string, string> = { safety: "shield-alert-outline", maintenance: "calendar-check-outline", project: "hammer-wrench", document: "file-document-outline", measurement: "tape-measure", professional_job: "account-hard-hat-outline", suggestion: "lightbulb-on-outline" };

export default function HomeDashboard() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await api<any>("/hi/home-dashboard/snapshot");
      setD(snap);
      if (snap?.ai_summary_enabled) {
        try { setSummary(await api<any>("/hi/home-dashboard/ai-summary")); } catch { setSummary(null); }
      } else setSummary({ enabled: false });
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); await load(); } catch (e: any) { Alert.alert("Action failed", e?.message || "Try again."); } finally { setBusy(false); } };
  const snooze = (item: any) => act(() => api(`/hi/home-dashboard/attention/${item.id}/snooze`, { method: "POST", body: { days: 7 } }));
  const dismiss = (item: any) => {
    if (item.is_safety) {
      Alert.alert("Safety alert", "Acknowledge that you've reviewed this safety item before dismissing it.",
        [{ text: "Cancel", style: "cancel" }, { text: "I've reviewed it", onPress: () => act(() => api(`/hi/home-dashboard/attention/${item.id}/dismiss`, { method: "POST", body: { acknowledge: true } })) }]);
    } else {
      act(() => api(`/hi/home-dashboard/attention/${item.id}/dismiss`, { method: "POST", body: { acknowledge: false } }));
    }
  };
  const toggleSummary = (v: boolean) => act(async () => { await api("/hi/home-dashboard/ai-summary/pref", { method: "PUT", body: { ai_summary_enabled: v } }); });

  if (loading || !d) return <View style={styles.root}><ScreenHeader title="Home Dashboard" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  // brand-new user (no property at all)
  if (d.is_new_user && d.setup_actions) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Home Dashboard" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.prompt}>What would you like to do today?</Text>
          <Text style={styles.empty}>Let's set up your home so Homie can help.</Text>
          {d.setup_actions.map((a: any) => (
            <Pressable key={a.route} testID={`dash-setup-${a.label}`} style={styles.setupBtn} onPress={() => router.push(a.route)}>
              <Text style={styles.setupText}>{a.label}</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.brandPrimary} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  const s = d.snapshot || {};
  const attention = d.attention || [];
  const top = d.top_actions || [];
  const pc = d.profile_completion;

  return (
    <View style={styles.root}>
      <ScreenHeader title={d.property?.name || "Home Dashboard"} right={
        <Pressable testID="dash-timeline" onPress={() => router.push("/home-intel/timeline")}>
          <MaterialCommunityIcons name="timeline-clock-outline" size={22} color={colors.onSurface} />
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.prompt}>What would you like to do today?</Text>
        <Pressable testID="dash-ask" style={styles.askBar} onPress={() => router.push("/home-intel/chat")}>
          <HomieFace size={26} pose="idle" />
          <Text style={styles.askText}>Ask Homie anything…</Text>
        </Pressable>

        {d.degraded && <Text style={styles.degraded}>{d.degraded_note}</Text>}

        {summary?.enabled !== false && summary?.summary ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <MaterialCommunityIcons name="sparkles" size={16} color={colors.brandPrimary} />
              <Text style={styles.summaryLabel}>Homie summary</Text>
              <Switch testID="dash-summary-toggle" value={true} onValueChange={toggleSummary} trackColor={{ true: colors.brandPrimary }} style={{ transform: [{ scale: 0.8 }] }} />
            </View>
            <Text style={styles.summaryText}>{summary.summary}</Text>
          </View>
        ) : summary?.enabled === false ? (
          <Pressable style={styles.summaryOff} onPress={() => toggleSummary(true)}><Text style={styles.summaryOffText}>Turn on Homie's daily summary</Text></Pressable>
        ) : null}

        {/* Today — top 3 */}
        {top.length > 0 && (
          <>
            <Text style={styles.section}>Today</Text>
            {top.map((it: any) => <AttentionCard key={it.id} it={it} busy={busy} onOpen={() => router.push(it.action_route)} onSnooze={() => snooze(it)} onDismiss={() => dismiss(it)} />)}
          </>
        )}

        {/* Snapshot */}
        <View style={styles.statRow}>
          <Stat label="Active projects" value={s.active_project_count} onPress={() => router.push("/home-intel/projects")} />
          <Stat label="Due care" value={s.due_maintenance_count} accent={s.due_maintenance_count > 0} onPress={() => router.push("/home-intel/maintenance")} />
          <Stat label="Urgent" value={s.urgent_alert_count} accent={s.urgent_alert_count > 0} />
        </View>
        <View style={styles.statRow}>
          <Stat label="Rooms" value={s.room_count} onPress={() => router.push("/home-intel/rooms")} />
          <Stat label="Assets" value={s.asset_count} onPress={() => router.push("/home-intel/assets")} />
          <Stat label="Documents" value={s.document_count} onPress={() => router.push("/home-intel/documents")} />
        </View>

        {/* Full attention list (below top 3) */}
        {attention.length > top.length && (
          <>
            <Text style={styles.section}>More to review</Text>
            {attention.slice(3).map((it: any) => <AttentionCard key={it.id} it={it} busy={busy} onOpen={() => router.push(it.action_route)} onSnooze={() => snooze(it)} onDismiss={() => dismiss(it)} />)}
          </>
        )}

        {attention.length === 0 && <Text style={styles.empty}>You're all caught up — nothing needs your attention right now.</Text>}

        {/* Profile completion */}
        {pc && (
          <>
            <Text style={styles.section}>Home information coverage</Text>
            <View style={styles.card}>
              <View style={styles.track}><View style={[styles.fill, { width: `${pc.coverage_pct}%` }]} /></View>
              <Text style={styles.coverage}>{pc.completed} of {pc.total} areas · {pc.coverage_pct}%</Text>
              <View style={styles.areaWrap}>
                {pc.areas.map((a: any) => (
                  <View key={a.key} style={styles.areaChip}>
                    <MaterialCommunityIcons name={a.done ? "check-circle" : "circle-outline"} size={14} color={a.done ? "#27AE60" : colors.onSurfaceTertiary} />
                    <Text style={styles.areaText}>{a.label}{a.count ? ` (${a.count})` : ""}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
        <Text style={styles.note}>This is an overview of your home information — not a home value, inspection, insurance or safety certification.</Text>
      </ScrollView>
    </View>
  );
}

function AttentionCard({ it, busy, onOpen, onSnooze, onDismiss }: any) {
  const color = STATUS_COLOR[it.attention_status] || colors.brandPrimary;
  return (
    <View style={[styles.itemCard, { borderLeftColor: color }]}>
      <Pressable testID={`dash-item-${it.id}`} style={styles.itemMain} onPress={onOpen}>
        <MaterialCommunityIcons name={(TYPE_ICON[it.attention_type] || "circle-outline") as any} size={20} color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.itemStatus} numberOfLines={1}>{it.attention_status}</Text>
          <Text style={styles.itemTitle} numberOfLines={2}>{it.title}</Text>
          <Text style={styles.itemDesc} numberOfLines={2}>{it.description}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
      </Pressable>
      <View style={styles.itemBtns}>
        <Pressable testID={`dash-open-${it.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: color }]} onPress={onOpen}><Text style={[styles.smallBtnText, { color }]}>{it.action_label}</Text></Pressable>
        {!it.is_safety && <Pressable testID={`dash-snooze-${it.id}`} disabled={busy} style={styles.smallBtn} onPress={onSnooze}><Text style={styles.smallBtnText}>Snooze</Text></Pressable>}
        <Pressable testID={`dash-dismiss-${it.id}`} disabled={busy} style={styles.smallBtn} onPress={onDismiss}><Text style={styles.smallBtnText}>{it.is_safety ? "Acknowledge" : "Dismiss"}</Text></Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value, accent, onPress }: { label: string; value: number; accent?: boolean; onPress?: () => void }) {
  return <Pressable style={styles.stat} onPress={onPress}><Text style={[styles.statVal, accent && value > 0 && { color: colors.warning }]}>{value ?? 0}</Text><Text style={styles.statLabel}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  prompt: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"], marginBottom: spacing.md },
  askBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  askText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  degraded: { color: colors.warning, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md, lineHeight: 18 },
  summaryCard: { backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { flex: 1, color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs, textTransform: "uppercase" },
  summaryText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginTop: 4, lineHeight: 21 },
  summaryOff: { marginTop: spacing.md, alignItems: "center", paddingVertical: spacing.sm },
  summaryOffText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2, textAlign: "center" },
  itemCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemMain: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  itemStatus: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  itemTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 2 },
  itemDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  itemBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  coverage: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, marginTop: 6 },
  areaWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  areaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  areaText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs },
  setupBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  setupText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, lineHeight: 20 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
});
