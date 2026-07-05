import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Badge = { key: string; label: string; icon: string; desc: string; earned: boolean; progress: number };
type Reward = { id: string; label: string; cost: number; kind: string; icon: string };
type Tier = { key: string; label: string; min: number; next: { label: string; remaining: number; at: number } | null };
type Impact = { region: string; neighbors: number; homes_upgraded_year: number; money_saved_cents: number; time_saved_hours: number; co2_saved_kg: number; estimate_note: string };
type Me = {
  contribution: { projects: number; helps: number; referrals: number; score: number };
  tier: Tier; percentile: number; badges: Badge[]; credits: number; referral_code: string;
  leaderboard_optin: boolean; has_location: boolean; impact: Impact | null; rewards: Reward[];
};
type LbEntry = { rank: number; name: string; score: number; projects: number; helps: number; tier: string; is_me: boolean };

type TabKey = "overview" | "rewards" | "leaderboard" | "campaigns";

export default function Loyalty() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");

  const load = useCallback(async () => {
    try { setMe(await api<Me>("/loyalty/me")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="loy-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Rewards</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabRow}>
        {([["overview", "Overview"], ["rewards", "Rewards"], ["leaderboard", "Leaders"], ["campaigns", "Campaigns"]] as [TabKey, string][]).map(([k, label]) => (
          <Pressable key={k} testID={`loy-tab-${k}`} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading || !me ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {tab === "overview" && <Overview me={me} />}
          {tab === "rewards" && <Rewards me={me} reload={load} />}
          {tab === "leaderboard" && <Leaderboard optin={me.leaderboard_optin} hasLocation={me.has_location} reload={load} />}
          {tab === "campaigns" && <Campaigns reload={load} />}
        </ScrollView>
      )}
    </View>
  );
}

function Overview({ me }: { me: Me }) {
  const c = me.contribution;
  const pct = me.tier.next ? Math.min(1, c.score / me.tier.next.at) : 1;
  return (
    <View>
      <View style={styles.tierCard}>
        <MaterialCommunityIcons name="medal" size={30} color={colors.brandPrimary} />
        <Text style={styles.tierLabel}>{me.tier.label}</Text>
        <Text style={styles.creditBig}>{me.credits}<Text style={styles.creditUnit}> credits</Text></Text>
        {me.tier.next ? (
          <>
            <View style={styles.progressBg}><View style={[styles.progressFill, { width: `${pct * 100}%` }]} /></View>
            <Text style={styles.tierNext}>{me.tier.next.remaining} pts to {me.tier.next.label}</Text>
          </>
        ) : <Text style={styles.tierNext}>Top tier reached 🏆</Text>}
      </View>

      <View style={styles.statRow}>
        <Stat icon="clipboard-check-outline" value={c.projects} label="Projects" />
        <Stat icon="hand-heart-outline" value={c.helps} label="Neighbors helped" />
        <Stat icon="account-multiple-plus-outline" value={c.referrals} label="Referrals" />
      </View>

      <Text style={styles.section}>Badges</Text>
      <View style={styles.badgeGrid}>
        {me.badges.map((b) => (
          <View key={b.key} style={[styles.badge, b.earned && styles.badgeOn]}>
            <MaterialCommunityIcons name={b.icon as any} size={26} color={b.earned ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <Text style={[styles.badgeLabel, b.earned && { color: colors.onSurface }]}>{b.label}</Text>
            <Text style={styles.badgeDesc}>{b.desc}</Text>
            {!b.earned && <View style={styles.miniBar}><View style={[styles.miniFill, { width: `${b.progress * 100}%` }]} /></View>}
            {b.earned && <MaterialCommunityIcons name="check-circle" size={14} color={colors.success} style={{ position: "absolute", top: 8, right: 8 }} />}
          </View>
        ))}
      </View>

      {me.impact && (
        <>
          <Text style={styles.section}>Your area · {me.impact.region}</Text>
          <View style={styles.impactCard}>
            <ImpactRow icon="home-group" label="Homes upgraded this year" value={String(me.impact.homes_upgraded_year)} />
            <ImpactRow icon="cash-multiple" label="Community money saved" value={money(me.impact.money_saved_cents)} />
            <ImpactRow icon="clock-outline" label="Time saved (est.)" value={`${me.impact.time_saved_hours} hrs`} />
            <ImpactRow icon="leaf" label="CO₂ avoided (est.)" value={`${me.impact.co2_saved_kg} kg`} />
            <ImpactRow icon="account-group-outline" label="Active neighbors" value={String(me.impact.neighbors)} last />
            <Text style={styles.estNote}>{me.impact.estimate_note}</Text>
          </View>
        </>
      )}
    </View>
  );
}

function Rewards({ me, reload }: { me: Me; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const redeem = async (r: Reward) => {
    if (me.credits < r.cost) { Alert.alert("Not enough credits", `You need ${r.cost - me.credits} more credits.`); return; }
    setBusy(r.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api<{ message: string }>("/loyalty/redeem", { method: "POST", body: { reward_id: r.id } });
      Alert.alert("Redeemed", res.message); reload();
    } catch (e: any) { Alert.alert("Couldn't redeem", e?.message || "Try again."); }
    finally { setBusy(null); }
  };
  return (
    <View>
      <View style={styles.balPill}><MaterialCommunityIcons name="star-four-points" size={16} color={colors.brandPrimary} /><Text style={styles.balText}>{me.credits} credits available</Text></View>
      <Text style={styles.helper}>Earn credits by completing projects, helping neighbors, and inviting people who actually build.</Text>
      {me.rewards.map((r) => {
        const can = me.credits >= r.cost;
        return (
          <View key={r.id} style={styles.rewardCard}>
            <MaterialCommunityIcons name={r.icon as any} size={24} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardLabel}>{r.label}</Text>
              <Text style={styles.rewardCost}>{r.cost} credits</Text>
            </View>
            <Pressable testID={`loy-redeem-${r.id}`} style={[styles.redeemBtn, !can && styles.redeemOff]} onPress={() => redeem(r)} disabled={busy === r.id}>
              {busy === r.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={[styles.redeemText, !can && { color: colors.onSurfaceTertiary }]}>{can ? "Redeem" : "Locked"}</Text>}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function Leaderboard({ optin, hasLocation, reload }: { optin: boolean; hasLocation: boolean; reload: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ entries: LbEntry[]; region?: string; needs_optin?: boolean; needs_location?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await api("/loyalty/leaderboard")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = async () => {
    try { await api("/loyalty/leaderboard/optin", { method: "POST", body: { optin: true } }); await load(); reload(); } catch {}
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  if (data?.needs_location) return (
    <View style={styles.gate}>
      <MaterialCommunityIcons name="map-marker-off-outline" size={34} color={colors.onSurfaceTertiary} />
      <Text style={styles.gateText}>Add your city or ZIP in Profile to see your neighborhood leaderboard.</Text>
      <Pressable testID="loy-add-location" style={styles.gateBtn} onPress={() => router.push("/(tabs)/profile")}><Text style={styles.gateBtnText}>Go to Profile</Text></Pressable>
    </View>
  );
  if (data?.needs_optin || !optin) return (
    <View style={styles.gate}>
      <MaterialCommunityIcons name="podium" size={34} color={colors.brandPrimary} />
      <Text style={styles.gateTitle}>Join the leaderboard</Text>
      <Text style={styles.gateText}>Opt in to be ranked among top contributors near you. Your name is shown only as first name + initial to others. Fully optional.</Text>
      <Pressable testID="loy-lb-optin" style={styles.gateBtn} onPress={join}><Text style={styles.gateBtnText}>Opt in</Text></Pressable>
    </View>
  );
  return (
    <View>
      <Text style={styles.helper}>Top contributors in {data?.region}. Ranked by real value — projects & neighbors helped.</Text>
      {(data?.entries || []).map((e) => (
        <View key={e.rank} style={[styles.lbRow, e.is_me && styles.lbMe]}>
          <Text style={[styles.lbRank, e.rank <= 3 && { color: colors.brandPrimary }]}>#{e.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbName}>{e.name}{e.is_me ? " (you)" : ""}</Text>
            <Text style={styles.lbMeta}>{e.tier} · {e.projects} projects · {e.helps} helped</Text>
          </View>
          <Text style={styles.lbScore}>{e.score}</Text>
        </View>
      ))}
    </View>
  );
}

function Campaigns({ reload }: { reload: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const d = await api<{ campaigns: any[] }>("/loyalty/campaigns"); setRows(d.campaigns); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { const r = await api<{ reward_credits?: number }>(`/loyalty/campaigns/${id}/join`, { method: "POST" }); await load(); reload(); if (r.reward_credits) Alert.alert("Joined!", `+${r.reward_credits} credits for stepping up.`); } catch (e: any) { Alert.alert("Couldn't join", e?.message || "Try again."); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  if (rows.length === 0) return <View style={styles.gate}><MaterialCommunityIcons name="bullhorn-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.gateText}>No active campaigns near you right now.</Text></View>;
  return (
    <View>
      <Text style={styles.helper}>Local initiatives you can join. Impact-first — never engagement tricks.</Text>
      {rows.map((c) => (
        <View key={c.id} style={styles.campCard}>
          <View style={styles.campTop}>
            <MaterialCommunityIcons name={c.icon as any} size={22} color={colors.brandPrimary} />
            <Text style={styles.campTitle}>{c.title}</Text>
          </View>
          <Text style={styles.campBlurb}>{c.blurb}</Text>
          <View style={styles.campMetaRow}>
            <Text style={styles.campMeta}>{c.region} · {c.progress}{c.goal ? `/${c.goal}` : ""} joined{c.reward_credits ? ` · +${c.reward_credits} credits` : ""}</Text>
          </View>
          <Pressable testID={`loy-camp-join-${c.id}`} style={[styles.joinBtn, c.joined && styles.joinedBtn]} onPress={() => !c.joined && join(c.id)} disabled={c.joined}>
            <Text style={[styles.joinText, c.joined && { color: colors.success }]}>{c.joined ? "Joined ✓" : "Join campaign"}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon as any} size={20} color={colors.brandPrimary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ImpactRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.impactRow, !last && styles.impactBorder]}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.onSurfaceSecondary} />
      <Text style={styles.impactLabel}>{label}</Text>
      <Text style={styles.impactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tabRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  tabTextOn: { color: colors.onBrandPrimary },
  tierCard: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  tierLabel: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  creditBig: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 40 },
  creditUnit: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.base },
  progressBg: { width: "100%", height: 8, borderRadius: 4, backgroundColor: colors.surface, marginTop: spacing.sm, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  tierNext: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, gap: 2 },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { width: "48%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  badgeOn: { borderColor: colors.brandPrimary },
  badgeLabel: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  badgeDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 16 },
  miniBar: { height: 5, borderRadius: 3, backgroundColor: colors.surface, marginTop: 4, overflow: "hidden" },
  miniFill: { height: 5, borderRadius: 3, backgroundColor: colors.brandPrimary },
  impactCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  impactRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  impactBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  impactLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  impactValue: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  estNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, fontStyle: "italic", marginTop: spacing.sm },
  balPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, backgroundColor: colors.brandPrimary + "18", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  balText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  helper: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginVertical: spacing.md },
  rewardCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rewardLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  rewardCost: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: 1 },
  redeemBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minWidth: 74, alignItems: "center" },
  redeemOff: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  redeemText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  gate: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["3xl"], paddingHorizontal: spacing.lg },
  gateTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  gateText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 20 },
  gateBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  gateBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  lbMe: { borderColor: colors.brandPrimary },
  lbRank: { color: colors.onSurfaceTertiary, fontFamily: font.display, fontSize: 18, width: 34 },
  lbName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  lbMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  lbScore: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 20 },
  campCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  campTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  campTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  campBlurb: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  campMetaRow: { flexDirection: "row" },
  campMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  joinBtn: { alignSelf: "flex-start", backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, marginTop: 2 },
  joinedBtn: { backgroundColor: colors.surface, borderColor: colors.success, borderWidth: 1 },
  joinText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
