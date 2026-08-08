import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_META: Record<string, { label: string; color: string }> = {
  fulfilled: { label: "Delivered", color: "#27AE60" },
  points_held: { label: "Processing", color: "#F2994A" },
  provider_processing: { label: "Processing", color: "#F2994A" },
  fraud_review: { label: "In review", color: "#2F80ED" },
  eligibility_review: { label: "In review", color: "#2F80ED" },
  failed: { label: "Returned", color: "#EB5757" },
  reversed: { label: "Reversed", color: "#EB5757" },
  declined: { label: "Declined", color: "#888" },
};

function makeKey() {
  return `rdm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function Redemption() {
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([api("/hi/rewards-funding/catalog"), api("/hi/rewards-funding/history")]);
      setData(c);
      setHistory(h.redemptions || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const redeem = async (item: any) => {
    if (busy) return;
    Alert.alert(
      "Redeem reward",
      `Use ${item.points_cost.toLocaleString()} points for a ${item.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Redeem",
          onPress: async () => {
            setBusy(item.id);
            try {
              const res = await api("/hi/rewards-funding/redeem", {
                method: "POST",
                body: { catalog_item_id: item.id, idempotency_key: makeKey() },
              });
              Alert.alert("Rewards", res.message || "Your redemption was received.");
              await load();
            } catch (e) {
              const msg = e instanceof ApiError ? e.message : "Something went wrong. Your points are safe.";
              Alert.alert("Rewards", msg);
              await load();
            } finally { setBusy(null); }
          },
        },
      ]
    );
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Redeem" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const disabled = !data.redemption_enabled;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Redeem Points" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balLabel}>AVAILABLE POINTS</Text>
          <Text style={styles.balValue}>{(data.available_points || 0).toLocaleString()}</Text>
          {data.pending_points ? <Text style={styles.balSub}>{data.pending_points} pending review</Text> : null}
        </View>

        {disabled ? (
          <View style={styles.pausedCard}>
            <MaterialCommunityIcons name="pause-circle-outline" size={20} color="#F2994A" />
            <Text style={styles.pausedText}>Rewards are temporarily unavailable. Your points remain safely recorded and you can redeem later.</Text>
          </View>
        ) : null}

        <Text style={styles.section}>Available rewards</Text>
        {(data.catalog || []).length === 0 ? <Text style={styles.empty}>No rewards available right now.</Text> :
          data.catalog.map((it: any) => {
            const canRedeem = !disabled && it.affordable && it.available;
            return (
              <View key={it.id} style={styles.rewardRow}>
                <View style={styles.giftIcon}><MaterialCommunityIcons name="gift-outline" size={22} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rewardName}>{it.name}</Text>
                  <Text style={styles.rewardSub}>{it.points_cost.toLocaleString()} points{it.provider_name ? ` · ${it.provider_name}` : ""}</Text>
                  {!it.available ? <Text style={styles.unavailable}>Temporarily unavailable</Text> : (!it.affordable && !disabled ? <Text style={styles.unavailable}>{(it.points_cost - (data.available_points || 0)).toLocaleString()} more points needed</Text> : null)}
                </View>
                <Pressable
                  testID={`redeem-${it.id}`}
                  disabled={!canRedeem || busy === it.id}
                  style={[styles.redeemBtn, (!canRedeem || busy === it.id) && styles.redeemBtnOff]}
                  onPress={() => redeem(it)}
                >
                  {busy === it.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[styles.redeemText, (!canRedeem) && styles.redeemTextOff]}>Redeem</Text>}
                </Pressable>
              </View>
            );
          })}

        <Text style={styles.section}>Redemption history</Text>
        {history.length === 0 ? <Text style={styles.empty}>No redemptions yet.</Text> :
          history.map((h) => {
            const m = STATUS_META[h.status] || { label: h.status, color: "#888" };
            return (
              <View key={h.id} style={styles.histRow}>
                <View style={[styles.dot, { backgroundColor: m.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.histName} numberOfLines={1}>{h.catalog_item_name || "Reward"}</Text>
                  <Text style={[styles.histStatus, { color: m.color }]}>{m.label}</Text>
                </View>
                <Text style={styles.histPts}>-{(h.points_redeemed || 0).toLocaleString()}</Text>
              </View>
            );
          })}

        <Text style={styles.note}>Rewards are funded by confirmed partner revenue. Points are a community feature — not cash — and a reward is only guaranteed once eligibility is confirmed.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  balanceCard: { backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary + "44", borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  balLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  balValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 44, marginTop: 2 },
  balSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  pausedCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: "#F2994A18", borderColor: "#F2994A55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  pausedText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  giftIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary + "18" },
  rewardName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  rewardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  unavailable: { color: "#EB5757", fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  redeemBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 84, alignItems: "center" },
  redeemBtnOff: { backgroundColor: colors.surfaceTertiary },
  redeemText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  redeemTextOff: { color: colors.onSurfaceTertiary },
  histRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  histName: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  histStatus: { fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  histPts: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg, lineHeight: 18 },
});
