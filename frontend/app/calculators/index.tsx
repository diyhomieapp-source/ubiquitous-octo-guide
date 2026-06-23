import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { CALCULATORS, CALC_CATEGORIES } from "@/src/calculators/registry";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function CalculatorsHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");

  const filtered = CALCULATORS.filter((c) =>
    !q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || c.blurb.toLowerCase().includes(q.toLowerCase()) || c.category.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="DIY Calculators" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Pro-grade material & cost estimators. Get exactly how much you need before you shop.</Text>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceTertiary} />
          <TextInput testID="calc-search" style={styles.searchInput} placeholder="Search calculators…" placeholderTextColor={colors.onSurfaceTertiary} value={q} onChangeText={setQ} />
        </View>

        {CALC_CATEGORIES.map((cat) => {
          const items = filtered.filter((c) => c.category === cat);
          if (items.length === 0) return null;
          return (
            <View key={cat} style={{ marginBottom: spacing.lg }}>
              <Text style={styles.catLabel}>{cat.toUpperCase()}</Text>
              <View style={styles.grid}>
                {items.map((c) => (
                  <Pressable key={c.id} testID={`calc-${c.id}`} style={styles.card} onPress={() => router.push(`/calculators/${c.id}`)}>
                    <View style={styles.cardIcon}><MaterialCommunityIcons name={c.icon as any} size={22} color={colors.brandPrimary} /></View>
                    <Text style={styles.cardName} numberOfLines={2}>{c.name.replace(" Calculator", "")}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
        {filtered.length === 0 && <Text style={styles.empty}>No calculators match “{q}”.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19, marginBottom: spacing.md },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, paddingVertical: spacing.md, outlineStyle: "none" } as any,
  catLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "31%", flexGrow: 1, minWidth: 100, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, alignItems: "flex-start" },
  cardIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  cardName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl },
});
