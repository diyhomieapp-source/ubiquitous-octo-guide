import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Task = { id: string; title: string; category: string; due_date: string; computed_status: string };
type Data = { season_now: string; groups: Record<string, Task[]> };
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const SEASON_ICON: Record<string, any> = { Spring: "flower-outline", Summer: "white-balance-sunny", Fall: "leaf-maple", Winter: "snowflake" };

export default function SeasonalChecklist() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api<Data>("/hi/maintenance/seasonal")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Seasonal Checklist" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            <Text style={styles.intro}>Group your recurring tasks by season so nothing slips through. Current season: <Text style={{ color: colors.brandPrimary }}>{data?.season_now}</Text></Text>
            {SEASONS.map((s) => {
              const tasks = data?.groups[s] || [];
              const isNow = s === data?.season_now;
              return (
                <View key={s} style={[styles.card, isNow && { borderColor: colors.brandPrimary }]}>
                  <View style={styles.cardHead}>
                    <MaterialCommunityIcons name={SEASON_ICON[s]} size={20} color={isNow ? colors.brandPrimary : colors.onSurfaceSecondary} />
                    <Text style={[styles.season, isNow && { color: colors.brandPrimary }]}>{s}</Text>
                    {isNow && <View style={styles.nowPill}><Text style={styles.nowText}>NOW</Text></View>}
                  </View>
                  {tasks.length === 0 ? <Text style={styles.empty}>No {s} tasks yet. Tag a task with this season when creating it.</Text> :
                    tasks.map((t) => (
                      <Pressable key={t.id} testID={`seasonal-${t.id}`} style={styles.row} onPress={() => router.push(`/home-intel/maintenance/${t.id}`)}>
                        <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={16} color={colors.onSurfaceTertiary} />
                        <Text style={styles.rowText} numberOfLines={1}>{t.title}</Text>
                        <Text style={styles.rowDate}>{t.due_date}</Text>
                      </Pressable>
                    ))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  season: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  nowPill: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  nowText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 9 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderTopColor: colors.border, borderTopWidth: 1 },
  rowText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  rowDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
