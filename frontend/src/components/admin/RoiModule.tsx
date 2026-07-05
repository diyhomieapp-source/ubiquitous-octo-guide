import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Room = { room: string; projects: number; saved_cents: number; spend_cents: number; shares: number; testimonials: number; avg_roi_pct: number };

const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function RoiModule() {
  const [totals, setTotals] = useState<any | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [drivers, setDrivers] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ totals: any; by_room: Room[]; top_share_drivers: Room[] }>("/admin/roi/analytics");
      setTotals(d.totals); setRooms(d.by_room); setDrivers(d.top_share_drivers);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Value Delivered</Text>
      <Text style={styles.sub}>ROI, savings and outcomes across every completed project — proof of the DIYhomie promise.</Text>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Projects" value={String(totals.projects)} />
          <Stat label="Saved" value={usd(totals.saved_cents)} />
          <Stat label="Value added" value={usd(totals.value_add_cents)} />
          <Stat label="Avg ROI" value={`${totals.avg_roi_pct}%`} />
          <Stat label="Shares" value={String(totals.shares)} />
          <Stat label="5★ stories" value={String(totals.testimonials)} />
        </View>
      )}

      <Text style={styles.section}>ROI by project type</Text>
      {rooms.length === 0 && <Text style={styles.empty}>No completed projects yet.</Text>}
      {rooms.map((r, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{r.room || "Other"}</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.roi}>{r.avg_roi_pct}% ROI</Text>
          </View>
          <Text style={styles.meta}>{r.projects} projects · saved {usd(r.saved_cents)} · {r.shares} shares · {r.testimonials} testimonials</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, r.avg_roi_pct / 5)}%` }]} /></View>
        </View>
      ))}

      <Text style={styles.section}>Top testimonial / share drivers</Text>
      {drivers.filter((d) => d.shares > 0).length === 0 && <Text style={styles.empty}>No shared stories yet.</Text>}
      {drivers.filter((d) => d.shares > 0).map((d, i) => (
        <View key={i} style={styles.driverRow}>
          <Text style={styles.name}>{d.room || "Other"}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.meta}>{d.shares} shares · {d.testimonials} 5★</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 68, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 17 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center" },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  roi: { color: colors.success, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
  driverRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
});
