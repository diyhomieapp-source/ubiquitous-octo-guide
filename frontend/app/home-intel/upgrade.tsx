import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Plan = {
  tier: string; label: string; price_label: string; amount: number;
  checkout_tier: string | null; tagline: string; highlights: string[]; current: boolean;
};
type Usage = Record<string, { used: number | null; limit: number }>;
type Me = { tier: string; usage: Usage; has_customer: boolean; status: string };

const USAGE_LABELS: { key: string; label: string }[] = [
  { key: "home", label: "Homes" },
  { key: "project", label: "Projects" },
  { key: "chat", label: "Homie chats today" },
  { key: "inventory", label: "Inventory items" },
  { key: "document", label: "Vault documents" },
];

export default function Upgrade() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        api<{ plans: Plan[] }>("/hi/subscription/plans"),
        api<Me>("/hi/subscription/me"),
      ]);
      setPlans(p.plans); setMe(m);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const origin = () => (Platform.OS === "web" ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));

  const subscribe = async (tier: string) => {
    setBusy(tier);
    try {
      const res = await api<{ url: string }>("/billing/checkout", { method: "POST", body: { tier, origin_url: origin() } });
      if (Platform.OS === "web") window.location.href = res.url;
      else { await WebBrowser.openBrowserAsync(res.url); load(); }
    } catch (e: any) {
      Alert.alert("Couldn't start checkout", e?.message || "Please try again.");
    } finally { setBusy(null); }
  };

  const manageBilling = async () => {
    setBusy("portal");
    try {
      const res = await api<{ url: string }>("/billing/customer-portal", { method: "POST", body: { origin_url: origin() } });
      if (Platform.OS === "web") window.location.href = res.url;
      else await WebBrowser.openBrowserAsync(res.url);
    } catch (e: any) {
      Alert.alert("Billing unavailable", e?.message || "Please try again.");
    } finally { setBusy(null); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Plans & Upgrade" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Plans & Upgrade" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>Unlock more of your home</Text>
        {me && <Text style={styles.sub}>You&apos;re on the {me.tier === "free" ? "Free" : (me.tier === "starter" ? "Starter" : "Pro")} plan.</Text>}

        {me && (
          <View style={styles.usageCard}>
            <Text style={styles.usageTitle}>Your usage</Text>
            {USAGE_LABELS.map((u) => {
              const d = me.usage[u.key];
              if (!d) return null;
              const unlimited = d.limit === -1;
              const used = d.used ?? 0;
              const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, d.limit)) * 100));
              const full = !unlimited && used >= d.limit;
              return (
                <View key={u.key} style={{ marginTop: spacing.sm }}>
                  <View style={styles.usageRow}>
                    <Text style={styles.usageLabel}>{u.label}</Text>
                    <Text style={[styles.usageVal, full && { color: colors.warning }]}>{unlimited ? "Unlimited" : `${used} / ${d.limit}`}</Text>
                  </View>
                  {!unlimited && <View style={styles.usageTrack}><View style={[styles.usageFill, { width: `${pct}%` }, full && { backgroundColor: colors.warning }]} /></View>}
                </View>
              );
            })}
          </View>
        )}

        {plans.map((p) => {
          const canBuy = !!p.checkout_tier && !p.current;
          const isBusy = busy === p.checkout_tier;
          return (
            <View key={p.tier} style={[styles.planCard, p.current && styles.planCardCurrent, p.tier === "pro" && styles.planCardPro]}>
              <View style={styles.planHead}>
                <View>
                  <Text style={styles.planLabel}>{p.label}</Text>
                  <Text style={styles.planTagline}>{p.tagline}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.planPrice}>{p.price_label}</Text>
                  {p.current && <View style={styles.currentTag}><Text style={styles.currentTagText}>CURRENT</Text></View>}
                </View>
              </View>
              <View style={styles.hr} />
              {p.highlights.map((h, i) => (
                <View key={i} style={styles.featRow}>
                  <MaterialCommunityIcons name="check-circle" size={16} color={p.tier === "pro" ? colors.brandPrimary : colors.success} />
                  <Text style={styles.featText}>{h}</Text>
                </View>
              ))}
              {canBuy && (
                <Pressable testID={`plan-choose-${p.tier}`} style={[styles.cta, p.tier === "pro" && styles.ctaPro]} disabled={isBusy} onPress={() => subscribe(p.checkout_tier!)}>
                  {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Choose {p.label}</Text>}
                </Pressable>
              )}
              {p.current && p.tier !== "free" && (
                <Pressable testID="plan-manage" style={styles.manageBtn} disabled={busy === "portal"} onPress={manageBilling}>
                  <Text style={styles.manageText}>{busy === "portal" ? "Opening…" : "Manage billing"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Text style={styles.footNote}>Plans renew monthly. Cancel anytime from Manage billing. Your home records are always yours — never locked behind a plan.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headline: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 4, marginBottom: spacing.md },
  usageCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  usageTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  usageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  usageLabel: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  usageVal: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  usageTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, marginTop: 5, overflow: "hidden" },
  usageFill: { height: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  planCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  planCardCurrent: { borderColor: colors.onSurfaceTertiary },
  planCardPro: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  planHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  planLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  planTagline: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  planPrice: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.lg },
  currentTag: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: 4 },
  currentTagText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  featRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  featText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  cta: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md, minHeight: 48, justifyContent: "center" },
  ctaPro: { backgroundColor: colors.brandPrimary },
  ctaText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  manageBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  manageText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  footNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, lineHeight: 18 },
});
