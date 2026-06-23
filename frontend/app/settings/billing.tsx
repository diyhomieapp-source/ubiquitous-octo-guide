import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { api, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";

type Payment = { amount: number; tier?: string; created_at?: string; currency?: string };
type Plan = { tier: string; label: string; amount: number; credits: number; voice_minutes: number };
type Summary = {
  tier: string; tier_label: string; status: string; credits: number; voice_minutes: number;
  amount: number; renews_at: string | null; cancel_at_period_end: boolean;
  credit_cents: number; payments: Payment[]; plans: Plan[]; has_customer: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return "—"; }
};

export default function BillingScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<Summary>("/billing/summary");
      setData(res);
    } catch { /* keep last */ } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); refresh(); }, [load, refresh]));

  const openPortal = async () => {
    setOpening(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const origin = Platform.OS === "web" ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || "");
      const res = await api<{ url: string }>("/billing/customer-portal", { method: "POST", body: { origin_url: origin } });
      if (Platform.OS === "web") window.location.href = res.url;
      else await WebBrowser.openBrowserAsync(res.url);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : "Could not open billing. Try again.";
      Alert.alert("Billing", msg);
    } finally { setOpening(false); }
  };

  const isPaid = data ? data.tier !== "free" : false;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Billing & Plan" />
      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Current plan */}
          <View style={styles.planCard}>
            <View style={styles.planTopRow}>
              <Text style={styles.planLabel}>CURRENT PLAN</Text>
              <View style={[styles.statusPill, isPaid ? styles.statusActive : styles.statusFree]}>
                <Text style={[styles.statusText, { color: isPaid ? colors.onSuccess : colors.onSurfaceSecondary }]}>
                  {(data?.status || "active").toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.planName}>{data?.tier_label || "Free"}</Text>
            <Text style={styles.planPrice}>
              {data && data.amount > 0 ? `${money(data.amount)}/mo` : "No active subscription"}
            </Text>

            <View style={styles.planMeta}>
              <View style={styles.metaItem}>
                <MaterialCommunityIcons name="lightning-bolt" size={16} color={colors.brandPrimary} />
                <Text style={styles.metaText}>{data?.credits ?? 0} credits</Text>
              </View>
              <View style={styles.metaItem}>
                <MaterialCommunityIcons name="microphone" size={16} color={colors.brandPrimary} />
                <Text style={styles.metaText}>{data?.voice_minutes ?? 0} voice min</Text>
              </View>
            </View>

            {data?.renews_at && (
              <Text style={styles.renewNote}>
                {data.cancel_at_period_end
                  ? `Cancels on ${fmtDate(data.renews_at)}`
                  : `Renews ${fmtDate(data.renews_at)}`}
              </Text>
            )}
          </View>

          {/* Referral credit */}
          {!!data?.credit_cents && data.credit_cents > 0 && (
            <View style={styles.creditCard}>
              <MaterialCommunityIcons name="gift" size={22} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.creditTitle}>{money(data.credit_cents)} account credit</Text>
                <Text style={styles.creditSub}>Auto-applies to your next invoice.</Text>
              </View>
            </View>
          )}

          {/* Manage billing (Stripe portal) */}
          <Pressable testID="billing-portal" style={styles.primaryBtn} onPress={openPortal} disabled={opening}>
            {opening ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <MaterialCommunityIcons name="credit-card-outline" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.primaryText}>Manage billing & card</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.helper}>
            Update your card, download invoices{isPaid ? ", or cancel" : ""} — securely via Stripe.
          </Text>

          {/* Upgrade / change plan */}
          <Pressable testID="billing-upgrade" style={styles.secondaryBtn} onPress={() => router.push("/paywall")}>
            <MaterialCommunityIcons name="rocket-launch-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.secondaryText}>{isPaid ? "Change plan" : "Upgrade your plan"}</Text>
          </Pressable>

          {/* Plan comparison */}
          <Text style={styles.sectionLabel}>PLANS</Text>
          <View style={styles.plansWrap}>
            {(data?.plans || []).map((p) => {
              const current = p.tier === data?.tier;
              return (
                <View key={p.tier} style={[styles.planRow, current && styles.planRowActive]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planRowName}>{p.label}</Text>
                    <Text style={styles.planRowMeta}>{p.credits} credits · {p.voice_minutes} voice min</Text>
                  </View>
                  <Text style={styles.planRowPrice}>{money(p.amount)}/mo</Text>
                  {current && <View style={styles.curBadge}><Text style={styles.curBadgeText}>CURRENT</Text></View>}
                </View>
              );
            })}
          </View>

          {/* Payment history */}
          <Text style={styles.sectionLabel}>PAYMENT HISTORY</Text>
          {data?.payments && data.payments.length > 0 ? (
            <View style={styles.histWrap}>
              {data.payments.map((t, i) => (
                <View key={i} style={[styles.histRow, i < data.payments.length - 1 && styles.histBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTier}>{(t.tier || "Subscription").toUpperCase()}</Text>
                    <Text style={styles.histDate}>{fmtDate(t.created_at)}</Text>
                  </View>
                  <Text style={styles.histAmount}>{money(t.amount)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHist}>No payments yet.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  planCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  planTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusActive: { backgroundColor: colors.success },
  statusFree: { backgroundColor: colors.surfaceTertiary },
  statusText: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  planName: { color: colors.onSurface, fontFamily: font.display, fontSize: 40, lineHeight: 44, marginTop: spacing.sm },
  planPrice: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.lg },
  planMeta: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  metaItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  renewNote: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md },
  creditCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.success, borderWidth: 1.5, marginTop: spacing.lg },
  creditTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  creditSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  helper: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.sm },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, paddingVertical: spacing.lg, borderRadius: radius.md, borderColor: colors.brandPrimary, borderWidth: 1.5, marginTop: spacing.md },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm },
  plansWrap: { gap: spacing.sm },
  planRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  planRowActive: { borderColor: colors.brandPrimary },
  planRowName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  planRowMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  planRowPrice: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  curBadge: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  curBadgeText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  histWrap: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  histRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  histBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  histTier: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  histDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  histAmount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  emptyHist: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, fontStyle: "italic" },
});
