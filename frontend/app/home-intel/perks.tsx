import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Perk = { label: string; included: boolean };
type Me = { tier: string; plan: { label: string; price_label: string }; perks: Perk[] };

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", pro: "Pro" };

export default function Perks() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [proPerks, setProPerks] = useState<Perk[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/hi/subscription/me");
      setMe(m);
      if (m.tier !== "pro") {
        const p = await api<{ plans: { tier: string; perks?: Perk[]; highlights: string[] }[] }>("/hi/subscription/plans");
        const pro = p.plans.find((x) => x.tier === "pro");
        // /plans returns highlights (not perks); show pro highlights as the upsell list.
        setProPerks((pro?.highlights || []).map((h) => ({ label: h, included: false })));
      }
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.root}><ScreenHeader title="Your perks" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const tier = me?.tier || "free";
  const isPro = tier === "pro";
  const unlocked = (me?.perks || []).filter((p) => p.included);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your perks" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          <MaterialCommunityIcons name="crown" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.badgeTier}>{TIER_LABEL[tier]} plan</Text>
            <Text style={styles.badgeSub}>{me?.plan.price_label}{isPro ? " · everything unlocked" : ""}</Text>
          </View>
        </View>

        <Text style={styles.headline}>{isPro ? "Everything you've unlocked" : "What you get today"}</Text>
        {unlocked.map((p, i) => (
          <View key={i} style={styles.perkRow}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
            <Text style={styles.perkText}>{p.label}</Text>
          </View>
        ))}

        {!isPro && (
          <>
            <View style={styles.upsell}>
              <Text style={styles.upsellTitle}>Unlock with Pro</Text>
              {proPerks.map((p, i) => (
                <View key={i} style={styles.perkRow}>
                  <MaterialCommunityIcons name="lock-outline" size={18} color={colors.onSurfaceTertiary} />
                  <Text style={styles.perkLocked}>{p.label}</Text>
                </View>
              ))}
            </View>
            <Pressable testID="perks-upgrade" style={styles.cta} onPress={() => router.push("/home-intel/upgrade")}>
              <Text style={styles.ctaText}>See plans & upgrade</Text>
            </Pressable>
          </>
        )}

        {isPro && (
          <Text style={styles.thanks}>Thanks for being a Pro member — you're getting the most out of Homie. 💛</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  badgeTier: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  badgeSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  headline: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  perkText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  perkLocked: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  upsell: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl },
  upsellTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.xs },
  cta: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  thanks: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xl, lineHeight: 20 },
});
