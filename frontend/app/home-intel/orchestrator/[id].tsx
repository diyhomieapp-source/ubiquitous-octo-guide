import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, SafetyCard } from "@/src/components/ui";

const HEALTH: Record<string, string> = { green: "#00E676", yellow: "#FFC400", orange: "#FF6A00", red: "#FF3D00" };
const HEALTH_SAFETY: Record<string, "safe" | "verify" | "stop" | "emergency"> = { green: "safe", yellow: "verify", orange: "stop", red: "emergency" };
const TASK_ICON: Record<string, string> = { complete: "check-circle", in_progress: "progress-clock", available: "circle-outline", pending: "lock-outline", blocked: "alert-circle-outline" };

export default function ProjectDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<any>(`/hi/orchestrator/projects/${id}`)); } catch { setData(null); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn: () => Promise<any>, err = "Try again.") => {
    setBusy(true);
    try { await fn(); await load(); } catch (e: any) { Alert.alert("Couldn't update", e?.message || err); } finally { setBusy(false); }
  };
  const taskAction = (tid: string, action: string) => act(() => api(`/hi/orchestrator/tasks/${tid}`, { method: "PUT", body: { action } }));
  const resolveRisk = (rid: string) => act(() => api(`/hi/orchestrator/risks/${rid}/resolve`, { method: "POST" }));
  const pause = () => act(() => api(`/hi/orchestrator/projects/${id}/pause`, { method: "POST" }));
  const resume = () => act(() => api(`/hi/orchestrator/projects/${id}/resume`, { method: "POST" }));
  const complete = async () => {
    setBusy(true);
    try {
      const res = await api<any>(`/hi/orchestrator/projects/${id}/complete`, { method: "POST" });
      Alert.alert("Project complete 🎉", `Project Passport created. Approx cost $${res.passport.approx_cost}.`);
      await load();
    } catch (e: any) { Alert.alert("Not ready", e?.message || "Resolve blockers first."); } finally { setBusy(false); }
  };

  if (loading) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;
  if (!data) return <View style={[styles.root, { paddingTop: insets.top }]}><Text style={styles.err}>Project not found.</Text></View>;

  const p = data.project;
  const nba = data.next_action;
  const health = data.health;
  const paused = p.status === "PAUSED";
  const completed = p.status === "COMPLETED";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="pd-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{p.title}</Text>
        <Pressable testID="pd-events" onPress={() => router.push(`/home-intel/orchestrator/events/${id}` as any)} style={styles.iconBtn} accessibilityLabel="Activity"><MaterialCommunityIcons name="history" size={20} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <View style={styles.phaseRow}>
          <View style={[styles.dot, { backgroundColor: HEALTH[health.status] }]} />
          <Text style={styles.phaseText}>{p.phase?.replace(/_/g, " ")}</Text>
          <View style={styles.statusTag}><Text style={styles.statusText}>{p.status?.replace(/_/g, " ")}</Text></View>
        </View>

        {/* Health in Homie's voice */}
        {health.status !== "green" ? (
          <SafetyCard testID="pd-health" level={HEALTH_SAFETY[health.status]} message={health.headline}>
            {health.can_continue_other_task ? <Text style={styles.hint}>You can keep working on other unaffected steps meanwhile.</Text> : null}
          </SafetyCard>
        ) : null}

        {/* Next Best Action */}
        {!completed ? (
          <View style={styles.nbaCard}>
            <Text style={styles.nbaLabel}>YOUR NEXT STEP</Text>
            <Text style={styles.nbaAction}>{nba.action}</Text>
            <View style={styles.wsRow}>
              <MaterialCommunityIcons name="view-dashboard-outline" size={14} color={colors.onSurfaceTertiary} />
              <Text style={styles.wsText}>{nba.workspace}</Text>
            </View>
            <Pressable testID="pd-why" onPress={() => setShowWhy((v) => !v)}><Text style={styles.why}>{showWhy ? "Hide why" : "Why?"}</Text></Pressable>
            {showWhy ? <Text style={styles.whyText}>{nba.why}</Text> : null}
            {nba.task_id ? (
              <View style={styles.nbaActions}>
                <Button testID="pd-nba-start" label="Start this" onPress={() => taskAction(nba.task_id, "start")} loading={busy} style={{ flex: 1 }} />
                <Button testID="pd-nba-done" label="Mark done" variant="secondary" icon="check" onPress={() => taskAction(nba.task_id, "complete")} loading={busy} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.passportCard}>
            <MaterialCommunityIcons name="certificate-outline" size={22} color={colors.success} />
            <Text style={styles.passportTitle}>Project Passport</Text>
            <Text style={styles.passportMeta}>{(p.passport?.materials_used || []).length} materials · approx ${p.passport?.approx_cost ?? 0} · {p.passport?.tasks_completed ?? 0} tasks</Text>
          </View>
        )}

        {/* Open risks */}
        {(data.risks || []).map((rk: any) => (
          <View key={rk.id} style={[styles.riskCard, { borderLeftColor: rk.kind === "safety" ? HEALTH.red : HEALTH.orange }]}>
            <Text style={styles.riskKind}>{rk.kind} · {rk.severity}</Text>
            <Text style={styles.riskDesc}>{rk.description}</Text>
            <Pressable testID={`pd-resolve-risk-${rk.id}`} style={styles.resolveBtn} onPress={() => resolveRisk(rk.id)}><Text style={styles.resolveText}>Mark resolved</Text></Pressable>
          </View>
        ))}

        {/* Tasks */}
        <Text style={styles.sectionTitle}>Plan</Text>
        {(data.tasks || []).map((t: any) => (
          <View key={t.id} style={styles.taskRow}>
            <MaterialCommunityIcons name={(TASK_ICON[t.status] || "circle-outline") as any} size={20} color={t.status === "complete" ? colors.success : t.status === "blocked" ? HEALTH.orange : t.status === "available" ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskTitle, t.status === "complete" && styles.done]}>{t.title}</Text>
              <Text style={styles.taskPhase}>{t.phase?.replace(/_/g, " ")}{t.is_inspection ? " · verify" : ""}</Text>
            </View>
            {t.status === "available" || t.status === "in_progress" ? (
              <Pressable testID={`pd-task-done-${t.id}`} disabled={busy} onPress={() => taskAction(t.id, "complete")} style={styles.taskBtn}><Text style={styles.taskBtnText}>Done</Text></Pressable>
            ) : t.status === "pending" ? <MaterialCommunityIcons name="lock-outline" size={16} color={colors.onSurfaceTertiary} /> : null}
          </View>
        ))}

        {/* Controls */}
        <Pressable testID="pd-fund" style={styles.fundCard} onPress={() => router.push(`/home-intel/funding/${id}` as any)}>
          <MaterialCommunityIcons name="piggy-bank-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.fundTitle}>Fund This Project</Text>
            <Text style={styles.fundSub}>Lower the cost & find legitimate savings</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.brandPrimary} />
        </Pressable>

        <View style={styles.controls}>
          {!completed && (paused
            ? <Button testID="pd-resume" label="Resume" icon="play" variant="secondary" onPress={resume} loading={busy} style={{ flex: 1 }} />
            : <Button testID="pd-pause" label="Pause" icon="pause" variant="secondary" onPress={pause} loading={busy} style={{ flex: 1 }} />)}
          {!completed ? <Button testID="pd-complete" label="Complete" icon="flag-checkered" onPress={complete} loading={busy} style={{ flex: 1 }} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  err: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, padding: spacing.lg },
  phaseRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  phaseText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textTransform: "capitalize" },
  statusTag: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  statusText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  hint: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  nbaCard: { backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  nbaLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  nbaAction: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, lineHeight: 22 },
  wsRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
  wsText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs },
  why: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.xs },
  whyText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  nbaActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  passportCard: { alignItems: "center", gap: spacing.xs, backgroundColor: colors.success + "14", borderColor: colors.success + "44", borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  passportTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  passportMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  riskCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  riskKind: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  riskDesc: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  resolveBtn: { alignSelf: "flex-start", marginTop: spacing.xs, borderColor: colors.success, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  resolveText: { color: colors.success, fontFamily: font.bold, fontSize: type.xs },
  sectionTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginTop: spacing.sm },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 44 },
  taskTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  done: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  taskPhase: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textTransform: "capitalize", marginTop: 1 },
  taskBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  taskBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  controls: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  fundCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  fundTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  fundSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
});
