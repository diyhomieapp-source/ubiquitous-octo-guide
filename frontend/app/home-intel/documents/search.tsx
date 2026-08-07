import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Doc = { id: string; title: string; category: string };

export default function SearchDocuments() {
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = useCallback(async (term?: string, cat?: string) => {
    setLoading(true); setSearched(true);
    try {
      const path = cat ? `/hi/documents?category=${cat}` : `/hi/documents/search?q=${encodeURIComponent(term || "")}`;
      const d = await api<{ documents: Doc[] }>(path);
      setDocs(d.documents);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (category) run(undefined, category); }, [category, run]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={category ? `${category.replace(/_/g, " ")}` : "Search Documents"} />
      <View style={styles.searchRow}>
        <TextInput testID="search-input" style={styles.input} value={q} onChangeText={setQ} onSubmitEditing={() => run(q)} returnKeyType="search"
          placeholder='e.g. "water heater warranty"' placeholderTextColor={colors.onSurfaceTertiary} autoFocus={!category} />
        <Pressable testID="search-go" style={styles.goBtn} onPress={() => run(q)}><MaterialCommunityIcons name="magnify" size={20} color={colors.onBrandPrimary} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          !searched ? <Text style={styles.empty}>Search by name, brand, model, serial or category.</Text> :
          docs.length === 0 ? <Text style={styles.empty}>No matching documents.</Text> :
          docs.map((d) => (
            <Pressable key={d.id} testID={`search-doc-${d.id}`} style={styles.row} onPress={() => router.push(`/home-intel/documents/${d.id}`)}>
              <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{d.title}</Text><Text style={styles.meta}>{d.category.replace(/_/g, " ")}</Text></View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  searchRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.lg },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  goBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
