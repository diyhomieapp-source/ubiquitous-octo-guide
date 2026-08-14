import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, EmptyState } from "@/src/components/ui";

const LABEL: Record<string, string> = {
  PROJECT_CREATED: "Project created", INTENT_CAPTURED: "Understood your goal", PROJECT_UPDATED: "Project updated",
  TASK_STARTED: "Started a task", TASK_COMPLETED: "Completed a task", TASK_BLOCKED: "Task blocked",
  SCHEDULE_RECALCULATED: "Schedule recalculated", MATERIALS_CALCULATED: "Materials calculated",
  PROCUREMENT_UPDATED: "Procurement updated", DELIVERY_UPDATED: "Delivery updated",
  SAFETY_HOLD_CREATED: "Safety hold added", SAFETY_HOLD_RESOLVED: "Safety hold resolved",
  CODE_CHECK_REQUESTED: "Code check requested", CODE_CHECK_COMPLETED: "Code check completed",
  DECISION_CREATED: "Decision noted", DECISION_SELECTED: "Decision selected", DECISION_COMMITTED: "Decision committed",
  PROJECT_COMPLETED: "Project completed", PROJECT_ARCHIVED: "Project archived", RISK_DETECTED: "Risk detected",
};

export default function ProjectEvents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEvents((await api<any>(`/hi/orchestrator/projects/${id}/events`)).events || []); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="ev-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Project activity</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.sm }}>
        {loading ? <LoadingState /> : events.length === 0 ? <EmptyState icon="history" title="No activity yet" message="Every change to this project will show up here." /> :
          events.map((e) => (
            <View key={e.id} style={styles.row}>
              <MaterialCommunityIcons name="circle-small" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{LABEL[e.type] || e.type}</Text>
                <Text style={styles.time}>{new Date(e.at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  time: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
});
