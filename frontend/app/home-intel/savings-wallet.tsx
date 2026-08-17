import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

export default function SavingsWallet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setW(await api<any>("/hi/funding/wallet")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="wallet-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My Savings</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading || !w ? <LoadingState /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>CONFIRMED THIS MONTH</Text>
            <Text style={styles.heroAmt}>${w.month_confirmed.toFixed(2)}</Text>
          </View>
          <View style={styles.grid}>
            <Tile label="Lifetime confirmed" value={`$${w.lifetime_confirmed.toFixed(2)}`} icon="cash-multiple" />
            <Tile label="Pending rewards" value={`$${w.pending.toFixed(2)}`} icon="clock-outline" />
            <Tile label="Active funding goals" value={w.active_goals} icon="target" />
          </View>
          <Text style={styles.note}>We only count confirmed savings backed by a receipt or provider — never forecasts. Your savings connect directly to the projects you want to complete.</Text>
        </ScrollView>
      )}
    </View>
  );
}

function Tile({ label, value, icon }: { label: string; value: any; icon: string }) {
  return (
    <View style={styles.tile}>
      <MaterialCommunityIcons name={icon as any} size={22} color={colors.brandPrimary} />
      <Text style={styles.tileVal}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  hero: { backgroundColor: colors.brandPrimary + "14", borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  heroLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  heroAmt: { color: colors.onSurface, fontFamily: font.display, fontSize: 44, marginTop: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: { flex: 1, minWidth: 100, alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  tileVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tileLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textAlign: "center" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
});
