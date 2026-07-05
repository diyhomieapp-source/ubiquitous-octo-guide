import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, Switch, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Progress = { total: number; completed: number; pct: number; joined: boolean; status: string; reward_claimed: boolean; story_opt_in: boolean };
type Milestone = { id: string; title: string; type: string; points: number; completed?: boolean; auto_ready?: boolean };
type Reward = { badge: string; discount_code: string; credit: number };
type Campaign = { slug: string; title: string; sponsor_name: string; theme: string; description: string; product_tag: string; featured_pro: string; reward: Reward; milestones: Milestone[]; progress: Progress };

export default function Campaigns() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [badges, setBadges] = useState<{ badge: string; sponsor: string; discount_code: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api<{ campaigns: Campaign[] }>("/campaigns"), api<{ badges: any[] }>("/campaigns/me")]);
      setCampaigns(c.campaigns); setBadges(m.badges);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openDetail = async (slug: string) => {
    try { setOpen(await api<Campaign>(`/campaigns/${slug}`)); } catch {}
  };
  const refreshOpen = async () => { if (open) setOpen(await api<Campaign>(`/campaigns/${open.slug}`)); };

  const join = async () => {
    if (!open) return; setBusy(true);
    try { await api(`/campaigns/${open.slug}/join`, { method: "POST" }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); await refreshOpen(); await load(); }
    catch {} finally { setBusy(false); }
  };
  const completeMilestone = async (m: Milestone) => {
    if (!open) return; setBusy(true);
    try {
      const r = await api<{ completed: boolean; reward: Reward | null }>(`/campaigns/${open.slug}/milestone/${m.id}/complete`, { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (r.completed && r.reward) Alert.alert("Campaign complete! 🎉", `You earned the "${r.reward.badge}" badge${r.reward.discount_code ? ` and code ${r.reward.discount_code}` : ""}.`);
      await refreshOpen(); await load();
    } catch (e: any) { Alert.alert("Not yet", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const toggleStory = async (v: boolean) => {
    if (!open) return;
    try { await api(`/campaigns/${open.slug}/story-optin`, { method: "POST", body: { opt_in: v } }); await refreshOpen(); } catch {}
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="camp-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Sponsored Challenges</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {badges.length > 0 && (
            <>
              <Text style={styles.section}>Your reward badges</Text>
              <View style={styles.badgeWrap}>
                {badges.map((b, i) => (
                  <View key={i} style={styles.badgeChip}>
                    <MaterialCommunityIcons name="medal-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.badgeText}>{b.badge}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.section}>Active campaigns</Text>
          {campaigns.length === 0 ? <Text style={styles.help}>No active campaigns right now — check back soon.</Text> :
            campaigns.map((c) => (
              <Pressable key={c.slug} testID={`camp-${c.slug}`} style={styles.card} onPress={() => openDetail(c.slug)}>
                <View style={styles.sponsorRow}>
                  <MaterialCommunityIcons name="bullhorn-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.sponsor}>Sponsored by {c.sponsor_name}</Text>
                  {c.progress.status === "completed" && <View style={styles.donePill}><Text style={styles.donePillText}>Completed</Text></View>}
                </View>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardDesc} numberOfLines={2}>{c.description}</Text>
                <View style={styles.bar}><View style={[styles.fill, { width: `${c.progress.pct}%` }]} /></View>
                <Text style={styles.cardMeta}>{c.progress.completed}/{c.progress.total} milestones · Reward: {c.reward?.badge}</Text>
              </Pressable>
            ))}
        </ScrollView>
      )}

      <Modal visible={!!open} animationType="slide" transparent onRequestClose={() => setOpen(null)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{open?.title}</Text>
              <Pressable testID="camp-close" hitSlop={10} onPress={() => setOpen(null)}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView>
              <Text style={styles.sponsor}>Sponsored by {open?.sponsor_name} · {open?.product_tag}</Text>
              {!!open?.featured_pro && <Text style={styles.featured}>Featured pro: {open.featured_pro}</Text>}
              <Text style={styles.cardDesc}>{open?.description}</Text>
              <View style={styles.rewardBox}>
                <MaterialCommunityIcons name="gift-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.rewardText}>Reward: {open?.reward?.badge}{open?.reward?.discount_code ? ` · code ${open.reward.discount_code}` : ""}</Text>
              </View>

              <Text style={styles.blockLabel}>Milestones</Text>
              {open?.milestones.map((m) => (
                <View key={m.id} style={styles.mRow}>
                  <MaterialCommunityIcons name={m.completed ? "check-circle" : "circle-outline"} size={22} color={m.completed ? colors.success : colors.onSurfaceTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mTitle}>{m.title}</Text>
                    <Text style={styles.mMeta}>{m.type} · {m.points} pts</Text>
                  </View>
                  {open.progress.joined && !m.completed && (
                    <Pressable testID={`camp-milestone-${m.id}`} style={[styles.mBtn, m.type === "lesson" && !m.auto_ready && styles.mBtnDim]} onPress={() => completeMilestone(m)} disabled={busy}>
                      <Text style={styles.mBtnText}>{m.type === "lesson" ? (m.auto_ready ? "Claim" : "Lesson?") : "Done"}</Text>
                    </Pressable>
                  )}
                </View>
              ))}

              {open?.progress.joined && (
                <View style={styles.storyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.storyLabel}>Share my story for marketing</Text>
                    <Text style={styles.storySub}>We only feature your project with your consent.</Text>
                  </View>
                  <Switch testID="camp-story-optin" value={!!open.progress.story_opt_in} onValueChange={toggleStory}
                    trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.onSurface} />
                </View>
              )}
            </ScrollView>

            {!open?.progress.joined ? (
              <Pressable testID="camp-join" style={styles.joinBtn} onPress={join} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.joinText}>Join challenge</Text>}
              </Pressable>
            ) : open.progress.status === "completed" ? (
              <View style={[styles.joinBtn, { backgroundColor: colors.success }]}><Text style={styles.joinText}>Completed ✓ Reward unlocked</Text></View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  badgeChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  badgeText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  sponsorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.xs },
  sponsor: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  featured: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  donePill: { marginLeft: "auto", backgroundColor: colors.success + "22", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  donePillText: { color: colors.success, fontFamily: font.bold, fontSize: 10 },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 19 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginTop: spacing.sm },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "88%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sheetTitle: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  rewardBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "12", borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  rewardText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  blockLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  mRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  mTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  mMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  mBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  mBtnDim: { backgroundColor: colors.onSurfaceTertiary },
  mBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 11 },
  storyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  storyLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  storySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  joinBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  joinText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
