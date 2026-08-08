import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  favorite: boolean;
  has_guide: boolean;
  total_steps: number;
  done_steps: number;
  progress: number;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "In Progress" },
  { key: "favorite", label: "Favorites" },
  { key: "completed", label: "Completed" },
];

export default function Projects() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const res = await api<ProjectSummary[]>("/projects");
      setItems(res);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleFav = async (p: ProjectSummary) => {
    Haptics.selectionAsync();
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, favorite: !x.favorite } : x)));
    try { await api(`/projects/${p.id}`, { method: "PATCH", body: { favorite: !p.favorite } }); } catch {}
  };

  const open = async (p: ProjectSummary) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await storage.setItem("diyhomie_active_project", p.id);
    router.push(`/project/${p.id}`);
  };

  const filtered = items.filter((p) => {
    if (filter === "all") return true;
    if (filter === "favorite") return p.favorite;
    if (filter === "active") return p.status === "active";
    if (filter === "completed") return p.status === "completed";
    return true;
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.headRow}>
        <Text style={styles.h1}>YOUR PROJECTS</Text>
        <Pressable testID="projects-search" hitSlop={10} onPress={() => router.push("/find")} accessibilityLabel="Search" accessibilityRole="button">
          <MaterialCommunityIcons name="magnify" size={24} color={colors.onSurface} />
        </Pressable>
      </View>
      <Text style={styles.sub}>Pick up any job right where you left off.</Text>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                testID={`projects-filter-${f.key}`}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => { Haptics.selectionAsync(); setFilter(f.key); }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={56} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>NOTHING HERE YET</Text>
          <Text style={styles.emptySub}>Start a project on the Homie tab and it’ll show up here.</Text>
          <Pressable testID="projects-start-cta" style={styles.startBtn} onPress={() => router.push("/(tabs)")}>
            <Text style={styles.startBtnText}>START A PROJECT</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
        >
          {filtered.map((p) => (
            <Pressable key={p.id} testID={`project-card-${p.id}`} style={styles.card} onPress={() => open(p)}>
              <View style={styles.cardTop}>
                <View style={[styles.statusDot, { backgroundColor: p.status === "completed" ? colors.success : colors.brandPrimary }]} />
                <Text style={styles.cardTitle} numberOfLines={1}>{p.title}</Text>
                <Pressable testID={`project-fav-${p.id}`} hitSlop={10} onPress={() => toggleFav(p)}>
                  <MaterialCommunityIcons name={p.favorite ? "star" : "star-outline"} size={22} color={p.favorite ? colors.warning : colors.onSurfaceTertiary} />
                </Pressable>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${p.progress}%` }]} />
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>
                  {p.status === "completed" ? "Completed" : p.has_guide ? `${p.done_steps}/${p.total_steps} steps` : "Plan not built yet"}
                </Text>
                <Text style={styles.metaPct}>{p.progress}%</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 36, lineHeight: 38 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 2 },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  chipTextOn: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1 },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
  startBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.md, marginTop: spacing.sm },
  startBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: radius.pill },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  cardMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  metaPct: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
});
