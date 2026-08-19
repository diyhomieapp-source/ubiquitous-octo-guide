import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const TYPE_META: Record<string, { icon: string; tone: string }> = {
  task_completed: { icon: "check-circle-outline", tone: "#27AE60" },
  task_skipped: { icon: "skip-next-circle-outline", tone: "#888" },
  photo: { icon: "camera-outline", tone: "#2D9CDB" },
  media: { icon: "video-outline", tone: "#2D9CDB" },
  note: { icon: "note-text-outline", tone: "#BB6BD9" },
  material_ready: { icon: "package-variant-closed-check", tone: "#27AE60" },
  blocker: { icon: "alert-octagon-outline", tone: "#EB5757" },
  plan_change: { icon: "swap-horizontal", tone: "#F2994A" },
  problem: { icon: "alert-circle-outline", tone: "#F2C94C" },
  project_complete: { icon: "trophy-outline", tone: "#FF5A00" },
};

export default function EvidenceTimeline() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/workspace/projects/${id}/timeline`)); }
    catch {} finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.root}><ScreenHeader title="Project Evidence" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const items = data?.items || [];

  return (
    <View style={styles.root}>
      <ScreenHeader title="Project Evidence" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.title}>{data?.project?.title}</Text>
        <View style={styles.stateChip}>
          <MaterialCommunityIcons name="state-machine" size={14} color={colors.brandPrimary} />
          <Text style={styles.stateText}>{data?.state?.label}</Text>
        </View>
        <Text style={styles.sub}>Every photo, step, change, and decision — your project memory, homeowner record, and professional handoff package.</Text>

        {items.length === 0 && <Text style={styles.empty}>Nothing recorded yet — evidence appears here as you work.</Text>}
        {items.map((it: any, idx: number) => {
          const m = TYPE_META[it.type] || TYPE_META.note;
          return (
            <View key={idx} style={styles.row}>
              <View style={styles.railCol}>
                <View style={[styles.dot, { backgroundColor: m.tone + "22", borderColor: m.tone }]}>
                  <MaterialCommunityIcons name={m.icon as any} size={16} color={m.tone} />
                </View>
                {idx < items.length - 1 && <View style={styles.rail} />}
              </View>
              <View style={styles.itemCard}>
                <Text style={styles.itemTitle}>{it.title}</Text>
                {it.detail ? <Text style={styles.itemDetail}>{it.detail}</Text> : null}
                <Text style={styles.itemDate}>{String(it.at).slice(0, 16).replace("T", " · ")}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl },
  stateChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.brandPrimary + "66", borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: spacing.xs },
  stateText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.xs },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl },
  row: { flexDirection: "row", gap: spacing.sm },
  railCol: { alignItems: "center", width: 36 },
  dot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rail: { flex: 1, width: 2, backgroundColor: colors.surfaceTertiary, marginVertical: 2 },
  itemCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 20 },
  itemDetail: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  itemDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.xs },
});
