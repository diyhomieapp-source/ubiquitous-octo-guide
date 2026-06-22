import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

const PLANS = [
  {
    tier: "pro",
    name: "PRO",
    price: "$12",
    highlight: true,
    tagline: "For the weekend warrior",
    perks: ["500 guide credits", "60 voice minutes with Homie", "Local code & permit checks", "Amazon supply bundles"],
  },
  {
    tier: "master",
    name: "MASTER",
    price: "$29",
    highlight: false,
    tagline: "For the serious renovator",
    perks: ["2,000 guide credits", "240 voice minutes", "Priority Homie responses", "Earn credits in the community"],
  },
];

export default function Paywall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [lastProject, setLastProject] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const projects = await api<any[]>("/projects");
        if (projects?.length) setLastProject(projects[0].title);
      } catch {}
    })();
  }, []);

  const startCheckout = async (tier: string) => {
    setBusy(tier);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const origin = Platform.OS === "web" ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || "");
      const res = await api<{ url: string; session_id: string }>("/billing/checkout", {
        method: "POST",
        body: { tier, origin_url: origin },
      });
      if (Platform.OS === "web") {
        window.location.href = res.url;
      } else {
        await WebBrowser.openBrowserAsync(res.url);
        router.replace({ pathname: "/billing/success", params: { session_id: res.session_id } });
      }
    } catch {
      setBusy(null);
    }
  };

  const startTrial = async () => {
    setBusy("trial");
    try {
      await updateProfile({ onboarded: true } as any);
      router.replace("/(tabs)");
    } catch {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing["2xl"] }}
        showsVerticalScrollIndicator={false}
      >
        {/* Personalized hook */}
        {lastProject ? (
          <View style={styles.resumeCard}>
            <MaterialCommunityIcons name="progress-wrench" size={20} color={colors.brandPrimary} />
            <Text style={styles.resumeText}>
              Your guide for <Text style={styles.resumeTitle}>“{lastProject}”</Text> is ready and waiting. Unlock to finish it.
            </Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <MaterialCommunityIcons name="lightning-bolt" size={16} color={colors.brandPrimary} />
            <Text style={styles.badgeText}>YOUR PROFILE IS READY</Text>
          </View>
        )}

        <Text style={styles.title}>UNLOCK YOUR{"\n"}SUPERHUMAN{"\n"}CONTRACTOR</Text>

        {/* Social proof */}
        <View style={styles.proofRow}>
          <View style={styles.stars}>
            {[0, 1, 2, 3, 4].map((i) => (
              <MaterialCommunityIcons key={i} name="star" size={15} color={colors.warning} />
            ))}
          </View>
          <Text style={styles.proofText}>Loved by 12,000+ confident DIYers</Text>
        </View>

        {PLANS.map((p) => (
          <View key={p.tier} style={[styles.card, p.highlight && styles.cardHighlight]}>
            {p.highlight && (
              <View style={styles.popular}><Text style={styles.popularText}>MOST POPULAR</Text></View>
            )}
            <View style={styles.cardHead}>
              <View>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planTagline}>{p.tagline}</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{p.price}</Text>
                <Text style={styles.period}>/month</Text>
              </View>
            </View>
            {p.perks.map((perk) => (
              <View key={perk} style={styles.perkRow}>
                <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
            <Pressable
              testID={`paywall-select-${p.tier}`}
              style={[styles.selectBtn, p.highlight ? styles.selectPrimary : styles.selectGhost]}
              onPress={() => startCheckout(p.tier)}
              disabled={!!busy}
            >
              {busy === p.tier ? (
                <ActivityIndicator color={p.highlight ? colors.onBrandPrimary : colors.onSurface} />
              ) : (
                <Text style={[styles.selectText, !p.highlight && { color: colors.onSurface }]}>
                  GET {p.name}
                </Text>
              )}
            </Pressable>
          </View>
        ))}

        {/* Trust row */}
        <View style={styles.trustRow}>
          <View style={styles.trustItem}><MaterialCommunityIcons name="lock-check" size={16} color={colors.onSurfaceTertiary} /><Text style={styles.trustText}>Secure Stripe checkout</Text></View>
          <View style={styles.trustItem}><MaterialCommunityIcons name="shield-check" size={16} color={colors.onSurfaceTertiary} /><Text style={styles.trustText}>Cancel anytime</Text></View>
        </View>

        <Pressable testID="paywall-start-trial" style={styles.trialBtn} onPress={startTrial} disabled={!!busy}>
          {busy === "trial" ? (
            <ActivityIndicator color={colors.onSurfaceTertiary} />
          ) : (
            <Text style={styles.trialText}>Keep exploring with my {user?.credits ?? 60} free credits</Text>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>Secure recurring billing via Stripe · cancel anytime.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  badge: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start",
    backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginBottom: spacing.lg,
  },
  badgeText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  resumeCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1.5,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg,
  },
  resumeText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  resumeTitle: { fontFamily: font.bold, color: colors.onBrandTertiary },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 46, lineHeight: 46 },
  proofRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl },
  stars: { flexDirection: "row", gap: 1 },
  proofText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.lg,
  },
  cardHighlight: { borderColor: colors.brandPrimary },
  popular: {
    position: "absolute", top: -11, left: spacing.xl, backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill,
  },
  popularText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: spacing.lg },
  planName: { color: colors.onSurface, fontFamily: font.display, fontSize: 32, letterSpacing: 1 },
  planTagline: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: -spacing.xs },
  priceRow: { alignItems: "flex-end" },
  price: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  period: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  perkText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  selectBtn: { marginTop: spacing.lg, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  selectPrimary: { backgroundColor: colors.brandPrimary },
  selectGhost: { backgroundColor: colors.surfaceTertiary },
  selectText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  trustRow: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, marginTop: spacing.xs, marginBottom: spacing.lg },
  trustItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  trustText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  trialBtn: { alignItems: "center", paddingVertical: spacing.lg, marginTop: spacing.sm },
  trialText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base, textDecorationLine: "underline" },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.xs },
});
