import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Task = {
  id: string; title: string; category: string; priority: string; due_date: string;
  computed_status: string; asset_name?: string | null; room_name?: string | null; frequency_type: string;
};
type Occ = { id: string; maintenance_task_id: string; completed_date?: string | null; status: string };
type Home = {
  due_now: Task[]; due_soon: Task[]; completed_recently: Occ[]; seasonal: Task[];
  season: string; home_care_score: number; score_note: string;
};

const STATUS_COLOR: Record<string, string> = {
  overdue: colors.error, due: colors.warning, upcoming: colors.info, completed: colors.success,
};
const PRIORITY_COLOR: Record<string, string> = { high: colors.error, medium: colors.warning, low: colors.info };

function TaskRow({ t, onPress }: { t: Task; onPress: () => void }) {
  return (
    <Pressable testID={`maint-task-${t.id}`} style={styles.taskRow} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: STATUS_COLOR[t.computed_status] || colors.info }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.taskTitle} numberOfLines={1}>{t.title}</Text>
        <Text style={styles.taskMeta} numberOfLines={1}>
          {t.category}{t.asset_name ? ` · ${t.asset_name}` : t.room_name ? ` · ${t.room_name}` : ""} · due {t.due_date}
        </Text>
      </View>
      <View style={[styles.pill, { borderColor: PRIORITY_COLOR[t.priority] || colors.border }]}>
        <Text style={[styles.pillText, { color: PRIORITY_COLOR[t.priority] || colors.onSurfaceTertiary }]}>{t.priority}</Text>
      </View>
    </Pressable>
  );
}

export default function MaintenanceHome() {
  const router = useRouter();
  const [data, setData] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<Home>("/hi/maintenance/home")); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const score = data?.home_care_score ?? 100;
  const scoreColor = score >= 80 ? colors.success : score >= 50 ? colors.warning : colors.error;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Care" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            <View style={styles.scoreCard}>
              <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
                <Text style={[styles.scoreNum, { color: scoreColor }]}>{score}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreLabel}>Home Care Score</Text>
                <Text style={styles.scoreNote}>{data?.score_note}</Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable testID="maint-add" style={styles.actionBtn} onPress={() => router.push("/home-intel/maintenance/add")}>
                <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.actionText}>Add task</Text>
              </Pressable>
              <Pressable testID="maint-suggestions" style={styles.actionBtnAlt} onPress={() => router.push("/home-intel/maintenance/suggestions")}>
                <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.actionTextAlt}>AI ideas</Text>
              </Pressable>
            </View>
            <View style={styles.actions}>
              <Pressable testID="maint-calendar" style={styles.actionBtnAlt} onPress={() => router.push("/home-intel/maintenance/calendar")}>
                <MaterialCommunityIcons name="calendar-month-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.actionTextAlt}>Calendar</Text>
              </Pressable>
              <Pressable testID="maint-seasonal" style={styles.actionBtnAlt} onPress={() => router.push("/home-intel/maintenance/seasonal")}>
                <MaterialCommunityIcons name="weather-partly-cloudy" size={18} color={colors.brandPrimary} />
                <Text style={styles.actionTextAlt}>{data?.season} tasks</Text>
              </Pressable>
              <Pressable testID="maint-all" style={styles.actionBtnAlt} onPress={() => router.push("/home-intel/maintenance/tasks")}>
                <MaterialCommunityIcons name="format-list-checks" size={18} color={colors.brandPrimary} />
                <Text style={styles.actionTextAlt}>All</Text>
              </Pressable>
            </View>

            <Text style={styles.section}>Due now &amp; overdue</Text>
            {(data?.due_now.length ?? 0) === 0 ? (
              <Text style={styles.empty}>Nothing due right now. Nice — your home is on track.</Text>
            ) : data!.due_now.map((t) => (
              <TaskRow key={t.id} t={t} onPress={() => router.push(`/home-intel/maintenance/${t.id}`)} />
            ))}

            <Text style={styles.section}>Coming up</Text>
            {(data?.due_soon.length ?? 0) === 0 ? (
              <Text style={styles.empty}>No upcoming tasks scheduled.</Text>
            ) : data!.due_soon.map((t) => (
              <TaskRow key={t.id} t={t} onPress={() => router.push(`/home-intel/maintenance/${t.id}`)} />
            ))}

            {(data?.completed_recently.length ?? 0) > 0 && (
              <>
                <Text style={styles.section}>Recently completed</Text>
                {data!.completed_recently.map((o) => (
                  <View key={o.id} style={styles.doneRow}>
                    <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
                    <Text style={styles.doneText}>Completed on {o.completed_date}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scoreCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  scoreRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  scoreNum: { fontFamily: font.display, fontSize: type["2xl"] },
  scoreLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  scoreNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  actionText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  actionBtnAlt: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  actionTextAlt: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  taskTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  taskMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  doneRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  doneText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
});
