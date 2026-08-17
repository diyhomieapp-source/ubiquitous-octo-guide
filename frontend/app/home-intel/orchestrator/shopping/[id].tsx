import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, EmptyState } from "@/src/components/ui";

export default function ShoppingList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<any>(`/hi/handoff/shopping/${id}`)); } catch { setData(null); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (item: any) => {
    setBusy(true);
    try { await api(`/hi/handoff/shopping/${id}/items/${item.id}/purchased?purchased=${!item.owned}`, { method: "POST" }); await load(); }
    catch {} finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="shop-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Shopping List</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading || !data ? <LoadingState /> : data.count === 0 ? (
        <EmptyState icon="cart-outline" title="Nothing to buy yet" message="Add materials or tools to your project and they'll show up here as a ready-to-buy list." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.sm }}>
          <View style={styles.totalCard}>
            <View><Text style={styles.totalLabel}>STILL TO BUY</Text><Text style={styles.totalVal}>${data.to_buy_total.toFixed(2)}</Text></View>
            <View style={styles.totalRight}><Text style={styles.subLabel}>Owned ${data.owned_total.toFixed(2)}</Text><Text style={styles.subLabel}>Total ${data.grand_total.toFixed(2)}</Text></View>
          </View>
          {data.items.map((it: any) => (
            <Pressable key={it.id} testID={`shop-item-${it.id}`} style={styles.item} onPress={() => toggle(it)} disabled={busy}>
              <MaterialCommunityIcons name={it.owned ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={22} color={it.owned ? colors.success : colors.onSurfaceTertiary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, it.owned && styles.done]}>{it.name}{it.quantity ? ` ×${it.quantity}` : ""}</Text>
                <Text style={styles.itemMeta}>{it.kind}{it.owned ? " · owned" : " · to buy"}</Text>
              </View>
              <Text style={[styles.itemCost, it.owned && styles.done]}>${it.estimate.toFixed(2)}</Text>
            </Pressable>
          ))}
          <Text style={styles.note}>{data.note}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  totalCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.brandPrimary + "14", borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  totalLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  totalVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 30 },
  totalRight: { alignItems: "flex-end", gap: 2 },
  subLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 44 },
  itemName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textTransform: "capitalize", marginTop: 1 },
  itemCost: { color: colors.onSurface, fontFamily: font.display, fontSize: type.lg },
  done: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
