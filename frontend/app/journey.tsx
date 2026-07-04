import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;

type Journey = {
  name: string; avatar_base64?: string | null; bio?: string; member_since?: string;
  share_public: boolean;
  projects_completed: number; money_saved_cents: number; total_hours: number;
  helpful_answers: number; community_experiences: number;
  skills: { tag: string; count: number }[];
  achievements: { id: string; title: string; icon: string; desc: string; earned: boolean }[];
  achievements_earned: number;
  timeline: any[];
};

function fmtDate(iso?: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

export default function JourneyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await api<Journey>("/journey")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async () => {
    if (!d) return;
    const msg = `I've completed ${d.projects_completed} home project${d.projects_completed === 1 ? "" : "s"} with DIYhomie and saved ${money(d.money_saved_cents)} vs hiring a pro! 🛠️`;
    try { await Share.share({ message: msg }); } catch {}
  };

  if (loading || !d) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }

  const initial = (d.name || "D").charAt(0).toUpperCase();
  const empty = d.projects_completed === 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="journey-back" hitSlop={10} onPress={() => router.back()}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My Journey</Text>
        <Pressable testID="journey-share" hitSlop={10} onPress={share}>
          <MaterialCommunityIcons name="share-variant-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"], gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {/* profile bubble */}
        <View style={styles.profileRow}>
          {d.avatar_base64 ? (
            <Image source={{ uri: `data:image/jpeg;base64,${d.avatar_base64}` }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{d.name}</Text>
            <Text style={styles.since}>{d.bio || `Member since ${fmtDate(d.member_since)}`}</Text>
          </View>
        </View>

        {/* headline stats */}
        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.success} />
            <Text style={[styles.statNum, { color: colors.success }]}>{money(d.money_saved_cents)}</Text>
            <Text style={styles.statLabel}>SAVED VS PRO</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="check-decagram" size={20} color={colors.brandPrimary} />
            <Text style={styles.statNum}>{d.projects_completed}</Text>
            <Text style={styles.statLabel}>COMPLETED</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="clock-outline" size={20} color={colors.info} />
            <Text style={[styles.statNum, { color: colors.info }]}>{d.total_hours}</Text>
            <Text style={styles.statLabel}>HOURS INVESTED</Text>
          </View>
        </View>

        {empty && (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="hammer" size={30} color={colors.brandPrimary} />
            <Text style={styles.emptyTitle}>Your journey starts with one project</Text>
            <Text style={styles.emptySub}>Finish a project and log it — Homie will write your story, tally your savings, and unlock achievements.</Text>
            <Pressable testID="journey-start" style={styles.emptyBtn} onPress={() => router.replace("/(tabs)")}>
              <Text style={styles.emptyBtnText}>START A PROJECT</Text>
            </Pressable>
          </View>
        )}

        {/* achievements */}
        <View>
          <Text style={styles.section}>ACHIEVEMENTS · {d.achievements_earned}/{d.achievements.length}</Text>
          <View style={styles.badgeGrid}>
            {d.achievements.map((a) => (
              <View key={a.id} style={[styles.badge, !a.earned && styles.badgeLocked]}>
                <MaterialCommunityIcons name={a.earned ? (a.icon as any) : "lock-outline"} size={26} color={a.earned ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.badgeTitle, !a.earned && { color: colors.onSurfaceTertiary }]} numberOfLines={2}>{a.title}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* skills */}
        {d.skills.length > 0 && (
          <View>
            <Text style={styles.section}>SKILLS EARNED</Text>
            <View style={styles.skillWrap}>
              {d.skills.map((s) => (
                <View key={s.tag} style={styles.skillChip}>
                  <MaterialCommunityIcons name="star-four-points" size={13} color={colors.onBrandTertiary} />
                  <Text style={styles.skillText}>{s.tag}</Text>
                  {s.count > 1 && <Text style={styles.skillCount}>×{s.count}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* timeline */}
        {d.timeline.length > 0 && (
          <View>
            <Text style={styles.section}>HOMEOWNER TIMELINE</Text>
            {d.timeline.map((e, i) => (
              <View key={e.id} style={styles.tlRow}>
                <View style={styles.tlLine}>
                  <View style={styles.tlDot}><MaterialCommunityIcons name={(e.skill_icon as any) || "check"} size={14} color={colors.onBrandPrimary} /></View>
                  {i < d.timeline.length - 1 && <View style={styles.tlBar} />}
                </View>
                <View style={styles.tlCard}>
                  <Text style={styles.tlDate}>{fmtDate(e.created_at)}</Text>
                  <Text style={styles.tlTitle}>{e.story_title}</Text>
                  <Text style={styles.tlProject} numberOfLines={1}>{e.title}</Text>
                  {!!e.story && <Text style={styles.tlStory}>{e.story}</Text>}
                  {!!e.after_photo && (
                    <Image source={{ uri: `data:image/jpeg;base64,${e.after_photo}` }} style={styles.tlPhoto} contentFit="cover" />
                  )}
                  <View style={styles.tlMeta}>
                    {e.money_saved_cents > 0 && (
                      <View style={styles.tlPill}><MaterialCommunityIcons name="cash" size={13} color={colors.success} /><Text style={[styles.tlPillText, { color: colors.success }]}>Saved {money(e.money_saved_cents)}</Text></View>
                    )}
                    {e.hours > 0 && (
                      <View style={styles.tlPill}><MaterialCommunityIcons name="clock-outline" size={13} color={colors.onSurfaceTertiary} /><Text style={styles.tlPillText}>{e.hours} hrs</Text></View>
                    )}
                    {!!e.skill_tag && (
                      <View style={styles.tlPill}><MaterialCommunityIcons name="star-four-points-outline" size={13} color={colors.brandPrimary} /><Text style={[styles.tlPillText, { color: colors.brandPrimary }]}>{e.skill_tag}</Text></View>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 28 },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  since: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  statGrid: { flexDirection: "row", gap: spacing.sm },
  statCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  emptyCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, textAlign: "center" },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 20 },
  emptyBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  emptyBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { width: "31%", flexGrow: 1, minWidth: 100, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, alignItems: "center", gap: spacing.xs },
  badgeLocked: { borderColor: colors.border, opacity: 0.6 },
  badgeTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: 11, textAlign: "center" },
  skillWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  skillChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  skillText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  skillCount: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm, opacity: 0.7 },
  tlRow: { flexDirection: "row", gap: spacing.md },
  tlLine: { alignItems: "center", width: 28 },
  tlDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  tlBar: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  tlCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: 4 },
  tlDate: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  tlTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  tlProject: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  tlStory: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: spacing.xs },
  tlPhoto: { width: "100%", height: 160, borderRadius: radius.sm, marginTop: spacing.sm },
  tlMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  tlPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  tlPillText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
});
