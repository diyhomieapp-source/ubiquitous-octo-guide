import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Task = { id: string; title: string; category: string; priority: string; due_date: string; computed_status: string; asset_name?: string | null; room_name?: string | null };
const TABS = [{ key: "", label: "All" }, { key: "due", label: "Due" }, { key: "upcoming", label: "Upcoming" }];
const STATUS_COLOR: Record<string, string> = { overdue: colors.error, due: colors.warning, upcoming: colors.info, completed: colors.success };

export default function MaintenanceTasks() {
  const router = useRouter();
  const [tab, setTab] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api<{ tasks: Task[] }>(`/hi/maintenance/tasks${tab ? `?tab=${tab}` : ""}`); setTasks(d.tasks); } catch {} finally { setLoading(false); }
  }, [tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="All Tasks" />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key || "all"} testID={`maint-tab-${t.key || "all"}`} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          tasks.length === 0 ? <Text style={styles.empty}>No tasks here. Add one from Home Care.</Text> :
          tasks.map((t) => (
            <Pressable key={t.id} testID={`maint-listrow-${t.id}`} style={styles.row} onPress={() => router.push(`/home-intel/maintenance/${t.id}`)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[t.computed_status] || colors.info }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>{t.category}{t.asset_name ? ` · ${t.asset_name}` : ""} · due {t.due_date} · {t.computed_status}</Text>
              </View>
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  tab: { flex: 1, alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingVertical: spacing.sm },
  tabOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
