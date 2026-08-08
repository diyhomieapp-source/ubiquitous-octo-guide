import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Item = { id: string; name: string; category: string; brand?: string | null; quantity?: string | null; unit?: string | null; storage_location?: string | null; status: string };
const CATS = ["Tool", "Material", "Supply", "Safety", "Hardware", "Paint", "Other"];
const STATUS_COLOR: Record<string, string> = { have: colors.success, low: colors.warning, out: colors.error };
const CAT_ICON: Record<string, any> = { Tool: "hammer-wrench", Material: "cube-outline", Supply: "package-variant", Safety: "shield-outline", Hardware: "nut", Paint: "format-paint", Other: "dots-horizontal" };

export default function InventoryList() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cat) params.set("category", cat);
      const d = await api<{ items: Item[]; total: number }>(`/hi/inventory${params.toString() ? `?${params}` : ""}`);
      setItems(d.items);
    } catch {} finally { setLoading(false); }
  }, [q, cat]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="My Toolbox" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Pressable testID="inv-add" style={styles.addBtn} onPress={() => router.push("/home-intel/inventory/add")}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add item</Text>
        </Pressable>
        <TextInput testID="inv-search" style={styles.input} value={q} onChangeText={setQ} placeholder="Search your tools & supplies" placeholderTextColor={colors.onSurfaceTertiary} returnKeyType="search" onSubmitEditing={load} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
          <Pressable testID="inv-cat-all" style={[styles.chip, !cat && styles.chipOn]} onPress={() => setCat(null)}><Text style={[styles.chipText, !cat && styles.chipTextOn]}>All</Text></Pressable>
          {CATS.map((c) => (
            <Pressable key={c} testID={`inv-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(cat === c ? null : c)}><Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text></Pressable>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          items.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="toolbox-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Your toolbox is empty. Add the tools and supplies you own so Homie can tell you what you already have for a project.</Text>
            </View>
          ) : items.map((it) => (
            <Pressable key={it.id} testID={`inv-item-${it.id}`} style={styles.row} onPress={() => router.push(`/home-intel/inventory/${it.id}`)}>
              <MaterialCommunityIcons name={CAT_ICON[it.category] || "cube-outline"} size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{it.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{it.category}{it.brand ? ` · ${it.brand}` : ""}{it.storage_location ? ` · ${it.storage_location}` : ""}</Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[it.status] || colors.info }]} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  addText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.md },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  empty: { alignItems: "center", gap: spacing.md, marginTop: spacing["2xl"], paddingHorizontal: spacing.lg },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
