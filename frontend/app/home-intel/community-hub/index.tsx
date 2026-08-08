import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_COLOR: Record<string, string> = { draft: "#888", submitted: "#F2994A", reviewing: "#F2994A", approved: "#27AE60", rejected: "#EB5757", removed: "#EB5757", archived: "#888" };

export default function CommunityHub() {
  const router = useRouter();
  const [tab, setTab] = useState<"feed" | "mine">("feed");
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState<string>("");
  const [feed, setFeed] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, f, m] = await Promise.all([
        api<any>("/hi/community/categories"),
        api<any>(`/hi/community/feed${cat ? `?category=${encodeURIComponent(cat)}` : ""}`),
        api<any>("/hi/community/content/mine"),
      ]);
      setCats(c.categories || []); setFeed(f.content || []); setMine(m.content || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, [cat]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Community" right={
        <Pressable testID="ch-contribute" onPress={() => router.push("/home-intel/community-hub/contribute")}><MaterialCommunityIcons name="plus-circle-outline" size={24} color={colors.brandPrimary} /></Pressable>
      } />
      <View style={styles.tabs}>
        <Pressable testID="ch-tab-feed" style={[styles.tab, tab === "feed" && styles.tabOn]} onPress={() => setTab("feed")}><Text style={[styles.tabText, tab === "feed" && styles.tabTextOn]}>Discover</Text></Pressable>
        <Pressable testID="ch-tab-mine" style={[styles.tab, tab === "mine" && styles.tabOn]} onPress={() => setTab("mine")}><Text style={[styles.tabText, tab === "mine" && styles.tabTextOn]}>My contributions</Text></Pressable>
      </View>

      {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          {tab === "feed" ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.sm }} style={{ marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg }}>
                <Pressable testID="ch-cat-all" style={[styles.chip, !cat && styles.chipOn]} onPress={() => setCat("")}><Text style={[styles.chipText, !cat && styles.chipTextOn]}>All</Text></Pressable>
                {cats.map((c) => <Pressable key={c} testID={`ch-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}><Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
              </ScrollView>
              {feed.length === 0 ? <Text style={styles.empty}>No community stories here yet. Be the first to share what you learned!</Text> :
                feed.map((c) => (
                  <Pressable key={c.id} testID={`ch-item-${c.id}`} style={styles.card} onPress={() => router.push(`/home-intel/community-hub/${c.id}`)}>
                    <View style={styles.labelRow}><Text style={styles.expLabel}>COMMUNITY EXPERIENCE</Text><Text style={styles.cat}>{c.category}</Text></View>
                    <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.cardBody} numberOfLines={2}>{c.body}</Text>
                    <View style={styles.metaRow}>
                      <View style={styles.meta}><MaterialCommunityIcons name="thumb-up-outline" size={14} color={colors.onSurfaceTertiary} /><Text style={styles.metaText}>{c.helpful_count} helpful</Text></View>
                      {c.author_label ? <Text style={styles.metaText}>· {c.author_label}</Text> : <Text style={styles.metaText}>· anonymous</Text>}
                      {c.difficulty ? <Text style={styles.metaText}>· {c.difficulty}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              <Text style={styles.note}>Community experiences supplement — they don't replace official manuals, safety guidance, or a licensed pro.</Text>
            </>
          ) : (
            <>
              <Pressable testID="ch-share-btn" style={styles.shareBtn} onPress={() => router.push("/home-intel/community-hub/contribute")}>
                <MaterialCommunityIcons name="hand-heart-outline" size={20} color="#fff" />
                <Text style={styles.shareText}>Help another homeowner — share a project</Text>
              </Pressable>
              {mine.length === 0 ? <Text style={styles.empty}>You haven't shared anything yet.</Text> :
                mine.map((c) => (
                  <Pressable key={c.id} testID={`ch-mine-${c.id}`} style={styles.card} onPress={() => c.moderation_status === "approved" ? router.push(`/home-intel/community-hub/${c.id}`) : router.push({ pathname: "/home-intel/community-hub/contribute", params: { id: c.id } })}>
                    <View style={styles.labelRow}>
                      <View style={[styles.statusTag, { borderColor: STATUS_COLOR[c.moderation_status] }]}><Text style={[styles.statusText, { color: STATUS_COLOR[c.moderation_status] }]}>{c.moderation_status}</Text></View>
                      <Text style={styles.cat}>{c.category}</Text>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.metaText}>{c.content_type.replace("Community", "")} · {c.visibility.replace(/_/g, " ")}</Text>
                  </Pressable>
                ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.brandPrimary + "18" },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  chipTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md, lineHeight: 20 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  expLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  cat: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: 4 },
  cardBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, flexWrap: "wrap" },
  meta: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs },
  statusTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  shareText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.md },
});
