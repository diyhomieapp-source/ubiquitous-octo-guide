import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Doc = { id: string; title: string; category: string; created_at: string; needs_review?: boolean; is_linked?: boolean };
const CATS: { key: string; label: string; icon: string }[] = [
  { key: "manual", label: "Manuals", icon: "book-open-variant" },
  { key: "receipt", label: "Receipts", icon: "receipt" },
  { key: "warranty", label: "Warranties", icon: "shield-check-outline" },
  { key: "project_photo", label: "Project Docs", icon: "image-multiple-outline" },
  { key: "estimate", label: "Estimates", icon: "file-document-outline" },
  { key: "product_label", label: "Photos", icon: "camera-outline" },
  { key: "other", label: "Other", icon: "dots-horizontal" },
];

export default function VaultHome() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ documents: Doc[]; counts: Record<string, number>; review_count: number }>("/hi/documents");
      setDocs(d.documents); setCounts(d.counts); setReviewCount(d.review_count);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your Home Documents" right={
        <Pressable testID="vault-search-btn" onPress={() => router.push("/home-intel/documents/search")}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Pressable testID="vault-add" style={styles.primary} onPress={() => router.push("/home-intel/documents/add")}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Add Document</Text>
        </Pressable>

        {reviewCount > 0 && (
          <Pressable testID="vault-review" style={styles.reviewBanner} onPress={() => router.push("/home-intel/documents/review")}>
            <MaterialCommunityIcons name="clipboard-alert-outline" size={20} color={colors.warning} />
            <Text style={styles.reviewText}>{reviewCount} document{reviewCount === 1 ? "" : "s"} need your review</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}

        <Text style={styles.section}>Categories</Text>
        <View style={styles.grid}>
          {CATS.map((c) => (
            <Pressable key={c.key} testID={`vault-cat-${c.key}`} style={styles.catCard} onPress={() => router.push(`/home-intel/documents/search?category=${c.key}`)}>
              <MaterialCommunityIcons name={c.icon as any} size={24} color={colors.brandPrimary} />
              <Text style={styles.catLabel}>{c.label}</Text>
              <Text style={styles.catCount}>{counts[c.key] || 0}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>Recent uploads</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} /> :
          docs.length === 0 ? <Text style={styles.empty}>No documents yet. Add manuals, receipts and warranties so Homie can use them.</Text> :
          docs.slice(0, 12).map((d) => (
            <Pressable key={d.id} testID={`vault-doc-${d.id}`} style={styles.docRow} onPress={() => router.push(`/home-intel/documents/${d.id}`)}>
              <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.docTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.docMeta}>{d.category.replace(/_/g, " ")}{!d.is_linked ? " · not linked" : ""}</Text>
              </View>
              {d.needs_review && <View style={styles.dot} />}
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  reviewBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderColor: colors.warning + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  reviewText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  catCard: { width: "31%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  catLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.xs, marginTop: spacing.xs, textAlign: "center" },
  catCount: { color: colors.brandPrimary, fontFamily: font.display, fontSize: type.lg },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  docRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  docTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  docMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
});
