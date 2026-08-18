import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Job = {
  id: string; job_type: string; status: string; progress: number; message: string;
  retry_count: number; created_at: string; completed_at?: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  design_concept: "Design concept", design_refine: "Design refinement",
  export: "Export", scan_analysis: "Photo analysis",
};
const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  queued: { label: "Queued", color: colors.info, icon: "clock-outline" },
  running: { label: "Running", color: colors.brandPrimary, icon: "progress-clock" },
  waiting_provider: { label: "Waiting on AI", color: colors.warning, icon: "cloud-sync-outline" },
  retrying: { label: "Retrying", color: colors.warning, icon: "refresh" },
  completed: { label: "Done", color: colors.success, icon: "check-circle-outline" },
  failed: { label: "Failed", color: colors.error, icon: "alert-circle-outline" },
  canceled: { label: "Canceled", color: colors.onSurfaceTertiary, icon: "cancel" },
};
const ACTIVE = ["queued", "running", "waiting_provider", "retrying"];

export default function BackgroundActivity() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ jobs: Job[]; active: number }>("/hi/jobs");
      setJobs(d.jobs);
      return d.active;
    } catch { return 0; } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    timer.current = setInterval(async () => {
      const active = await load();
      if (!active && timer.current) { clearInterval(timer.current); timer.current = null; }
    }, 4000);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [load]));

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const cancel = async (id: string) => {
    try { await api(`/hi/jobs/${id}/cancel`, { method: "POST" }); load(); } catch {}
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Background Activity" />
      {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.sub}>Long-running work Homie does for you — design renders, analysis and exports. You can keep using the app while these finish.</Text>
          {!jobs.length && (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="sleep" size={28} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Nothing running right now.</Text>
            </View>
          )}
          {jobs.map((j) => {
            const m = STATUS_META[j.status] || STATUS_META.queued;
            const active = ACTIVE.includes(j.status);
            return (
              <View key={j.id} testID={`job-${j.id}`} style={styles.card}>
                <View style={styles.rowTop}>
                  <MaterialCommunityIcons name={m.icon as any} size={20} color={m.color} />
                  <Text style={styles.title}>{TYPE_LABEL[j.job_type] || j.job_type}</Text>
                  <View style={[styles.badge, { borderColor: m.color }]}><Text style={[styles.badgeText, { color: m.color }]}>{m.label}</Text></View>
                </View>
                <Text style={styles.msg}>{j.message}</Text>
                {active && (
                  <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(5, j.progress)}%` }]} /></View>
                )}
                {j.status === "queued" && (
                  <Pressable testID={`job-cancel-${j.id}`} style={styles.cancelBtn} onPress={() => cancel(j.id)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  sub: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceTertiary, marginBottom: spacing.md },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
  emptyText: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceTertiary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontFamily: font.medium, fontSize: type.sm },
  msg: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  track: { height: 5, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginTop: spacing.sm, overflow: "hidden" },
  fill: { height: 5, backgroundColor: colors.brandPrimary, borderRadius: 3 },
  cancelBtn: { alignSelf: "flex-start", marginTop: spacing.sm, minHeight: 44, justifyContent: "center" },
  cancelText: { fontFamily: font.medium, fontSize: type.base, color: colors.error },
});
