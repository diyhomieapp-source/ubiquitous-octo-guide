import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const SUGGESTIONS = ["paint a wall", "install a faucet", "unclog a drain", "patch drywall"];

export default function KnowledgeSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (query?: string) => {
    const term = (query ?? q).trim();
    if (!term) return;
    setQ(term); setLoading(true); setResults(null);
    try { const d = await api<{ results: any[] }>("/hi/knowledge/retrieve", { method: "POST", body: { query: term } }); setResults(d.results); }
    catch { setResults([]); } finally { setLoading(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Knowledge Base" right={
        <Pressable testID="kb-contribute" onPress={() => router.push("/home-intel/knowledge/contribute")}><MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.brandPrimary} /></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Search source-backed DIY knowledge — every answer shows where it came from.</Text>
        <View style={styles.searchRow}>
          <TextInput testID="kb-input" style={styles.input} value={q} onChangeText={setQ} placeholder="What do you want to do?" placeholderTextColor={colors.onSurfaceTertiary} returnKeyType="search" onSubmitEditing={() => search()} />
          <Pressable testID="kb-search" style={styles.searchBtn} onPress={() => search()}><MaterialCommunityIcons name="magnify" size={20} color={colors.onBrandPrimary} /></Pressable>
        </View>

        {!results && !loading && (
          <View style={styles.wrap}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.chip} onPress={() => search(s)}><Text style={styles.chipText}>{s}</Text></Pressable>
            ))}
          </View>
        )}

        {loading && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />}

        {results && (results.length === 0 ? <Text style={styles.empty}>No matching knowledge yet. Try different words, or ask Homie.</Text> :
          results.map((r) => (
            <View key={r.entity_id} testID={`kb-result-${r.entity_id}`} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{r.canonical_name}</Text>
                <View style={styles.typeTag}><Text style={styles.typeText}>{r.entity_type.replace(/_/g, " ")}</Text></View>
              </View>
              {!!r.description && <Text style={styles.cardDesc}>{r.description}</Text>}
              {r.assertions?.length > 0 && r.assertions.map((a: any, i: number) => (
                <Text key={i} style={styles.assertion}>• {a.value}</Text>
              ))}
              {r.source_references?.length > 0 && (
                <View style={styles.srcRow}>
                  <MaterialCommunityIcons name="source-branch" size={13} color={colors.info} />
                  <Text style={styles.srcText}>Source: {r.source_references[0].title}</Text>
                </View>
              )}
            </View>
          )))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.md },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  searchBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.lg },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.xl, textAlign: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  typeTag: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  typeText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  cardDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.xs },
  assertion: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: 4 },
  srcRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  srcText: { color: colors.info, fontFamily: font.medium, fontSize: type.xs },
});
