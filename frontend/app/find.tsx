import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { EmptyState, LoadingState, ErrorState } from "@/src/components/ui";

const GROUP_ICON: Record<string, string> = {
  "My Home": "home-variant-outline",
  "My Projects": "clipboard-list-outline",
  "Home Care": "wrench-outline",
  "Guides": "book-open-variant",
  "Community Experiences": "account-group-outline",
};
const TYPE_ICON: Record<string, string> = {
  room: "floor-plan", asset: "fridge-outline", document: "file-document-outline", measurement: "ruler",
  project: "hammer-screwdriver", maintenance: "calendar-check-outline", template: "book-open-variant",
  guide: "school-outline", community: "account-group-outline",
};
const SOURCE_LABEL: Record<string, string> = { private: "Yours", verified: "Verified guide", community: "Community" };

export default function FindScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ context_type?: string; context_id?: string; context_label?: string }>();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const timer = useRef<any>(null);

  const run = useCallback(async (text: string) => {
    if (!text.trim()) { setGroups([]); setCount(null); setSearched(false); return; }
    setLoading(true); setError(null);
    try {
      let path = `/hi/search?q=${encodeURIComponent(text.trim())}`;
      if (params.context_type && params.context_id) path += `&context_type=${params.context_type}&context_id=${params.context_id}`;
      const res = await api<any>(path);
      setGroups(res.groups || []); setCount(res.result_count); setSearched(true);
    } catch (e: any) { setError(e?.message || "Search failed. Try again."); } finally { setLoading(false); }
  }, [params.context_type, params.context_id]);

  const onChange = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(text), 350);
  };

  const open = async (res: any) => {
    Keyboard.dismiss();
    try { api(`/hi/search/select?entity_type=${res.entity_type}`, { method: "POST" }); } catch {}
    if (res.deep_link) router.push(res.deep_link as any);
  };

  const noResultActions = [
    { icon: "robot-happy-outline", label: "Ask Homie", route: "/homie" },
    { icon: "fridge-plus-outline", label: "Add Asset", route: "/home-intel/asset-add" },
    { icon: "file-upload-outline", label: "Upload Document", route: "/home-intel/documents/add" },
    { icon: "hammer-screwdriver", label: "Start Project", route: "/home-intel/projects/start" },
    { icon: "book-open-variant", label: "Search Guides", route: "/search" },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.searchBar}>
        <Pressable testID="find-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="find-input"
            value={q}
            onChangeText={onChange}
            onSubmitEditing={() => run(q)}
            autoFocus
            placeholder={params.context_label ? `Search in ${params.context_label}…` : "Search your home, projects, guides…"}
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            returnKeyType="search"
            accessibilityLabel="Search"
          />
          {q ? <Pressable testID="find-clear" onPress={() => onChange("")} hitSlop={8}><MaterialCommunityIcons name="close-circle" size={18} color={colors.onSurfaceTertiary} /></Pressable> : null}
        </View>
      </View>
      {params.context_label ? <Text style={styles.ctxNote}>Searching within {params.context_label} · <Text style={styles.ctxLink} onPress={() => router.setParams({ context_type: "", context_id: "", context_label: "" })}>search everything</Text></Text> : null}

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }}>
        {loading ? <LoadingState message="Searching…" /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={() => run(q)} /> : null}

        {!loading && !error && searched && count === 0 ? (
          <View style={{ gap: spacing.md }}>
            <EmptyState icon="magnify-close" title="No matches yet" message={`We couldn't find anything for “${q}”. Try one of these:`} />
            <View style={styles.actionGrid}>
              {noResultActions.map((a) => (
                <Pressable key={a.label} testID={`find-action-${a.label}`} style={styles.actionChip} onPress={() => router.push(a.route as any)}>
                  <MaterialCommunityIcons name={a.icon as any} size={18} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {!loading && !error && !searched ? (
          <EmptyState icon="magnify" title="Find anything in your home" message="Try “kitchen projects”, “water heater manual”, or “what's due this month”." />
        ) : null}

        {!loading && count && count > 0 ? groups.map((g) => (
          <View key={g.group} style={{ gap: spacing.sm }}>
            <View style={styles.groupHead}>
              <MaterialCommunityIcons name={(GROUP_ICON[g.group] || "magnify") as any} size={16} color={colors.onSurfaceTertiary} />
              <Text style={styles.groupTitle}>{g.group}</Text>
              <Text style={styles.groupCount}>{g.results.length}</Text>
            </View>
            {g.results.map((res: any) => (
              <Pressable key={`${res.entity_type}-${res.entity_id}`} testID={`find-result-${res.entity_id}`} style={styles.resultCard} onPress={() => open(res)}>
                <View style={styles.resultIcon}><MaterialCommunityIcons name={(TYPE_ICON[res.entity_type] || "file-outline") as any} size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle} numberOfLines={1}>{res.title}</Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    {res.summary}{res.related ? ` · ${res.related}` : ""}
                  </Text>
                  <View style={styles.tagRow}>
                    <View style={styles.tag}><Text style={styles.tagText}>{SOURCE_LABEL[res.source_type] || res.entity_type}</Text></View>
                    {res.confidence_level ? <View style={[styles.tag, styles.confTag]}><Text style={[styles.tagText, { color: colors.info }]}>{res.confidence_level} confidence</Text></View> : null}
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        )) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 44 },
  input: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  ctxNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  ctxLink: { color: colors.brandPrimary, fontFamily: font.bold },
  groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  groupTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  groupCount: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  resultCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 44 },
  resultIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  resultTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  resultMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  tagRow: { flexDirection: "row", gap: spacing.xs, marginTop: 4 },
  tag: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  confTag: { borderColor: colors.info + "66" },
  tagText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.3 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  actionText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
});
