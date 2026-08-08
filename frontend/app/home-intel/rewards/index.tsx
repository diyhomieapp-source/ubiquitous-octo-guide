import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const EARN_META: Record<string, { label: string; icon: string }> = {
  project_contribution: { label: "Share a useful project", icon: "clipboard-check-outline" },
  referral: { label: "Refer a friend", icon: "account-multiple-plus-outline" },
  feedback: { label: "Provide feedback", icon: "message-star-outline" },
  bug_report: { label: "Report a bug", icon: "bug-outline" },
  community_contribution: { label: "Help improve DIYhomie", icon: "hand-heart-outline" },
};
const STATUS_COLOR: Record<string, string> = { pending: "#F2994A", approved: "#27AE60", declined: "#888", reversed: "#EB5757", redeemed: "#2F80ED" };

export default function RewardsHome() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api("/hi/rewards/home")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Rewards" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const acc = data.account; const p = data.progress;

  return (
    <View style={styles.root}>
      <ScreenHeader title="DIYhomie Points" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balLabel}>AVAILABLE POINTS</Text>
          <Text style={styles.balValue}>{acc.available_points.toLocaleString()}</Text>
          <Text style={styles.balSub}>{acc.pending_points} pending review · {acc.redeemed_points} redeemed</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${p.pct}%` }]} /></View>
          <Text style={styles.progressText}>{p.next_reward_at - p.available} points to your next reward</Text>
        </View>

        <View style={styles.linkRow}>
          <Pressable testID="rewards-redeem" style={[styles.linkBtn, styles.linkBtnFill]} onPress={() => router.push("/home-intel/rewards/redemption")}><MaterialCommunityIcons name="gift-outline" size={16} color="#fff" /><Text style={[styles.linkText, { color: "#fff" }]}>Redeem</Text></Pressable>
          <Pressable testID="rewards-activity" style={styles.linkBtn} onPress={() => router.push("/home-intel/rewards/activity")}><MaterialCommunityIcons name="history" size={16} color={colors.brandPrimary} /><Text style={styles.linkText}>Activity</Text></Pressable>
          <Pressable testID="rewards-terms" style={styles.linkBtn} onPress={() => router.push("/home-intel/rewards/terms")}><MaterialCommunityIcons name="information-outline" size={16} color={colors.brandPrimary} /><Text style={styles.linkText}>Terms</Text></Pressable>
        </View>

        <Text style={styles.section}>Ways to earn</Text>
        <Pressable testID="earn-project_contribution" style={styles.earnRow} onPress={() => router.push("/home-intel/rewards/contribute")}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={styles.earnLabel}>Complete &amp; share a project</Text><Text style={styles.earnSub}>Reviewed before points are awarded</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable testID="earn-referral" style={styles.earnRow} onPress={() => router.push("/home-intel/rewards/referral")}>
          <MaterialCommunityIcons name="account-multiple-plus-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={styles.earnLabel}>Refer a friend</Text><Text style={styles.earnSub}>Points after they join &amp; get set up</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable testID="earn-feedback" style={styles.earnRow} onPress={() => router.push("/home-intel/rewards/feedback")}>
          <MaterialCommunityIcons name="message-star-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={styles.earnLabel}>Feedback &amp; bug reports</Text><Text style={styles.earnSub}>Eligible reports reviewed by our team</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>Recent activity</Text>
        {(data.recent || []).length === 0 ? <Text style={styles.empty}>No point activity yet.</Text> :
          data.recent.map((e: any) => (
            <View key={e.id} style={styles.actRow}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[e.status] || "#888" }]} />
              <View style={{ flex: 1 }}><Text style={styles.actDesc} numberOfLines={1}>{e.description}</Text><Text style={styles.actStatus}>{e.status}</Text></View>
              <Text style={[styles.actPts, { color: e.point_amount >= 0 ? "#27AE60" : "#EB5757" }]}>{e.point_amount >= 0 ? "+" : ""}{e.point_amount}</Text>
            </View>
          ))}
        <Text style={styles.note}>DIYhomie Points are a community feature — not cash or a monetary balance.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  balanceCard: { backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary + "44", borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  balLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  balValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 44, marginTop: 2 },
  balSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  progressText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: 6 },
  linkRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  linkBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: spacing.sm },
  linkBtnFill: { backgroundColor: colors.brandPrimary },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  earnRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  earnLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  earnSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  actRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  actDesc: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  actStatus: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  actPts: { fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg, lineHeight: 18 },
});
