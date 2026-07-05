import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Order = { id: string; supplier_name: string; mode: string; status: string; subtotal_cents: number; quoted_cents?: number | null; items: any[]; updated_at: string };

const SC: Record<string, string> = { rfq: colors.info, quoted: colors.warning, confirmed: colors.brandPrimary, fulfilled: colors.success, cancelled: colors.error };

export default function Orders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setOrders(await api<Order[]>("/material-orders")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="ord-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Material Orders</Text>
        <View style={{ width: 28 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {orders.length === 0 ? (
            <View style={styles.empty}><MaterialCommunityIcons name="package-variant" size={38} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No orders yet. Browse suppliers to request a quote or order materials.</Text>
              <Pressable style={styles.browseBtn} onPress={() => router.replace("/suppliers")}><Text style={styles.browseText}>BROWSE SUPPLIERS</Text></Pressable>
            </View>
          ) : orders.map((o) => (
            <Pressable key={o.id} testID={`ord-${o.id}`} style={styles.card} onPress={() => router.push(`/orders/${o.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{o.supplier_name}</Text>
                <Text style={styles.meta}>{o.items.length} items · {money(o.quoted_cents || o.subtotal_cents)}{o.mode === "rfq" ? " (RFQ)" : ""}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: (SC[o.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.pillText, { color: SC[o.status] || colors.onSurfaceTertiary }]}>{o.status}</Text></View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  browseBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  browseText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
});
