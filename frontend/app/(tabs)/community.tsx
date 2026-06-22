import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Badge, compact, duration } from "@/src/components/CommunityBits";

type Stats = { completed: number; difficulty: number; avg_minutes: number; avg_cost_cents: number; success_rate: number };
type Project = { slug: string; title: string; category: string; icon: string; blurb: string; stats: Stats; experience_count: number };
type FeedItem = { id: string; author: string; badge?: string; title: string; project_title: string; project_slug?: string };

export default function Community() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([
        api<Project[]>("/community/projects", { auth: false }),
        api<FeedItem[]>("/community/feed?limit=15", { auth: false }),
      ]);
      setProjects(p);
      setFeed(f);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalDone = projects.reduce((s, p) => s + (p.stats?.completed || 0), 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.h1}>COMMUNITY</Text>
        <Text style={styles.sub}>
          AI guides you first — then learn from {compact(totalDone)}+ homeowners who've actually done it.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
        >
          {/* live feed */}
          {feed.length > 0 && (
            <>
              <View style={styles.feedHead}>
                <View style={styles.livePulse} />
                <Text style={styles.feedLabel}>JUST COMPLETED</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
                style={{ marginHorizontal: -spacing.lg }}
              >
                {feed.map((f) => (
                  <Pressable
                    key={f.id}
                    testID={`feed-${f.id}`}
                    style={styles.feedCard}
                    onPress={() => f.project_slug && router.push(`/community/${f.project_slug}`)}
                  >
                    <View style={styles.feedAvatar}>
                      <Text style={styles.feedAvatarText}>{f.author.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.feedAuthor} numberOfLines={1}>{f.author}</Text>
                    <Badge label={f.badge} small />
                    <Text style={styles.feedProject} numberOfLines={2}>{f.project_title}</Text>
                    <View style={styles.feedDone}>
                      <MaterialCommunityIcons name="check-decagram" size={13} color={colors.success} />
                      <Text style={styles.feedDoneText}>Completed</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {/* projects */}
          <Text style={styles.sectionLabel}>BROWSE BY PROJECT</Text>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {projects.map((p) => (
              <Pressable
                key={p.slug}
                testID={`community-project-${p.slug}`}
                style={styles.projCard}
                onPress={() => router.push(`/community/${p.slug}`)}
              >
                <View style={styles.projIcon}>
                  <MaterialCommunityIcons name={p.icon as any} size={26} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projCat}>{p.category.toUpperCase()}</Text>
                  <Text style={styles.projTitle}>{p.title}</Text>
                  <View style={styles.projStats}>
                    <View style={styles.projStat}>
                      <MaterialCommunityIcons name="account-group" size={13} color={colors.onSurfaceTertiary} />
                      <Text style={styles.projStatText}>{compact(p.stats.completed)} done</Text>
                    </View>
                    <View style={styles.projStat}>
                      <MaterialCommunityIcons name="clock-outline" size={13} color={colors.onSurfaceTertiary} />
                      <Text style={styles.projStatText}>{duration(p.stats.avg_minutes)}</Text>
                    </View>
                    <View style={styles.projStat}>
                      <MaterialCommunityIcons name="speedometer" size={13} color={colors.onSurfaceTertiary} />
                      <Text style={styles.projStatText}>{p.stats.difficulty}/10</Text>
                    </View>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 38, lineHeight: 40 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 2, lineHeight: 19 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  feedHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  livePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  feedLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5 },
  feedCard: { width: 150, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, gap: 4 },
  feedAvatar: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  feedAvatarText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  feedAuthor: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  feedProject: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  feedDone: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  feedDoneText: { color: colors.success, fontFamily: font.bold, fontSize: 11 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  projCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1 },
  projIcon: { width: 50, height: 50, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  projCat: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  projTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginVertical: 1 },
  projStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: 2 },
  projStat: { flexDirection: "row", alignItems: "center", gap: 3 },
  projStatText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
