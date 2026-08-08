import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Occ = { id: string; maintenance_task_id: string; scheduled_date: string; status: string };
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function MaintenanceCalendar() {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [occ, setOcc] = useState<Occ[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const d = await api<{ counts_by_day: Record<string, number>; occurrences: Occ[] }>("/hi/maintenance/calendar"); setCounts(d.counts_by_day); setOcc(d.occurrences); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startDow = first.getDay();
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(`${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return cells;
  }, [cursor]);

  const selectedOcc = selected ? occ.filter((o) => (o.scheduled_date || "").slice(0, 10) === selected) : [];
  const todayStr = new Date().toISOString().slice(0, 10);

  const shift = (dir: number) => {
    setSelected(null);
    setCursor((c) => { let m = c.m + dir, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Maintenance Calendar" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            <View style={styles.navRow}>
              <Pressable testID="cal-prev" onPress={() => shift(-1)} style={styles.navBtn}><MaterialCommunityIcons name="chevron-left" size={24} color={colors.onSurface} /></Pressable>
              <Text style={styles.monthLabel}>{MONTHS[cursor.m]} {cursor.y}</Text>
              <Pressable testID="cal-next" onPress={() => shift(1)} style={styles.navBtn}><MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurface} /></Pressable>
            </View>

            <View style={styles.dowRow}>{DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}</View>
            <View style={styles.calGrid}>
              {grid.map((day, i) => {
                if (!day) return <View key={i} style={styles.cell} />;
                const n = counts[day] || 0;
                const isToday = day === todayStr;
                const isSel = day === selected;
                return (
                  <Pressable key={i} testID={`cal-day-${day}`} style={[styles.cell, isSel && styles.cellSel, isToday && styles.cellToday]} onPress={() => setSelected(day)}>
                    <Text style={[styles.cellNum, isSel && { color: colors.brandPrimary }]}>{parseInt(day.slice(-2), 10)}</Text>
                    {n > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{n}</Text></View>}
                  </Pressable>
                );
              })}
            </View>

            {selected && (
              <>
                <Text style={styles.section}>Scheduled on {selected}</Text>
                {selectedOcc.length === 0 ? <Text style={styles.empty}>Nothing scheduled that day.</Text> :
                  selectedOcc.map((o) => (
                    <Pressable key={o.id} testID={`cal-occ-${o.id}`} style={styles.row} onPress={() => router.push(`/home-intel/maintenance/${o.maintenance_task_id}`)}>
                      <MaterialCommunityIcons name="wrench-outline" size={18} color={colors.brandPrimary} />
                      <Text style={styles.rowText}>Open task</Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
                    </Pressable>
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
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  navBtn: { padding: spacing.sm },
  monthLabel: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl },
  dowRow: { flexDirection: "row" },
  dow: { flex: 1, textAlign: "center", color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  cellSel: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary, borderWidth: 1 },
  cellToday: { borderColor: colors.borderStrong, borderWidth: 1 },
  cellNum: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 2, paddingHorizontal: 3 },
  badgeText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 10 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  rowText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
});
