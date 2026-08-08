import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_COLOR: Record<string, string> = { pending: "#F2994A", approved: "#27AE60", declined: "#888", reversed: "#EB5757", redeemed: "#2F80ED" };

export default function PointsActivity() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const d = await api<{ entries: any[] }>("/hi/rewards/activity"); setRows(d.entries); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Points activity" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.hint}>This is your immutable point history. Every change is a separate entry.</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          rows.length === 0 ? <Text style={styles.empty}>No entries yet.</Text> :
            rows.map((e) => (
              <View key={e.id} style={styles.row} testID={`ledger-${e.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.desc}>{e.description}</Text>
                  <Text style={styles.meta}>{(e.created_at || "").slice(0, 10)} · <Text style={{ color: STATUS_COLOR[e.status] || "#888" }}>{e.status}</Text> · balance {e.balance_after}</Text>
                </View>
                <Text style={[styles.pts, { color: e.point_amount >= 0 ? "#27AE60" : "#EB5757" }]}>{e.point_amount >= 0 ? "+" : ""}{e.point_amount}</Text>
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  desc: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  pts: { fontFamily: font.bold, fontSize: type.lg },
});
