import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Supplier = { id: string; name: string; categories: string[]; location: string; pro_only: boolean; hours: string; blurb: string; min_order_cents: number; delivery: boolean; pickup: boolean; verified: boolean };

export default function Suppliers() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cats, setCats] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = cat ? `?category=${encodeURIComponent(cat)}` : "";
      const d = await api<{ categories: string[]; suppliers: Supplier[] }>(`/suppliers${q}`);
      setCats(d.categories); setSuppliers(d.suppliers);
    } catch {} finally { setLoading(false); }
  }, [cat]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="sup-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Order Materials</Text>
        <Pressable testID="sup-orders" hitSlop={10} onPress={() => router.push("/orders")}><MaterialCommunityIcons name="clipboard-list-outline" size={22} color={colors.onSurface} /></Pressable>
      </View>

      <View style={styles.catRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.lg }}>
          <Pressable testID="sup-cat-all" style={[styles.chip, !cat && styles.chipOn]} onPress={() => setCat(null)}><Text style={[styles.chipText, !cat && styles.chipTextOn]}>All</Text></Pressable>
          {cats.map((c) => (
            <Pressable key={c} testID={`sup-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}><Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text></Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {suppliers.length === 0 ? (
            <View style={styles.empty}><MaterialCommunityIcons name="store-search-outline" size={34} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No suppliers in this category yet.</Text></View>
          ) : suppliers.map((s) => (
            <Pressable key={s.id} testID={`sup-${s.id}`} style={styles.card} onPress={() => router.push(`/suppliers/${s.id}`)}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{s.name}</Text>
                {s.pro_only && <View style={styles.proTag}><Text style={styles.proTagText}>PRO</Text></View>}
              </View>
              <Text style={styles.blurb} numberOfLines={2}>{s.blurb}</Text>
              <View style={styles.metaRow}>
                <Meta icon="map-marker-outline" text={s.location} />
                <Meta icon="cart-outline" text={`Min ${money(s.min_order_cents)}`} />
                {s.delivery && <Meta icon="truck-outline" text="Delivery" />}
                {s.pickup && <Meta icon="storefront-outline" text="Pickup" />}
              </View>
              <View style={styles.catTags}>{s.categories.map((c) => <Text key={c} style={styles.catTag}>{c}</Text>)}</View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  return <View style={styles.meta}><MaterialCommunityIcons name={icon as any} size={13} color={colors.onSurfaceTertiary} /><Text style={styles.metaText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  catRow: { paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  proTag: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 9 },
  blurb: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  catTags: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  catTag: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, backgroundColor: colors.brandPrimary + "18", paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
});
