import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

const PLANS = [
  {
    tier: "pro",
    name: "PRO",
    price: "$12",
    period: "/mo",
    highlight: true,
    perks: ["500 text credits / month", "60 voice minutes", "Local code & permit checks", "Amazon supply bundles"],
  },
  {
    tier: "master",
    name: "MASTER",
    price: "$29",
    period: "/mo",
    highlight: false,
    perks: ["2000 text credits / month", "240 voice minutes", "Priority Homie responses", "Earn credits in community"],
  },
];

export default function Paywall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile, setUser } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const choosePlan = async (tier: string) => {
    setBusy(tier);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const updated = await api<any>("/billing/subscribe", { method: "POST", body: { tier } });
      setUser(updated);
      await updateProfile({ onboarded: true } as any);
      router.replace("/(tabs)");
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
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing["2xl"] }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badge}>
          <MaterialCommunityIcons name="lightning-bolt" size={16} color={colors.brandPrimary} />
          <Text style={styles.badgeText}>YOUR PROFILE IS READY</Text>
        </View>

        <Text style={styles.title}>UNLOCK YOUR{"\n"}SUPERHUMAN{"\n"}CONTRACTOR</Text>
        <Text style={styles.subtitle}>
          Homie knows your tools, your budget, and your local building codes. Pick a plan to start building.
        </Text>

        {PLANS.map((p) => (
          <View key={p.tier} style={[styles.card, p.highlight && styles.cardHighlight]}>
            {p.highlight && (
              <View style={styles.popular}>
                <Text style={styles.popularText}>MOST POPULAR</Text>
              </View>
            )}
            <View style={styles.cardHead}>
              <Text style={styles.planName}>{p.name}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{p.price}</Text>
                <Text style={styles.period}>{p.period}</Text>
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
              onPress={() => choosePlan(p.tier)}
              disabled={!!busy}
            >
              {busy === p.tier ? (
                <ActivityIndicator color={p.highlight ? colors.onBrandPrimary : colors.onSurface} />
              ) : (
                <Text style={[styles.selectText, !p.highlight && { color: colors.onSurface }]}>
                  CHOOSE {p.name}
                </Text>
              )}
            </Pressable>
          </View>
        ))}

        <Pressable testID="paywall-start-trial" style={styles.trialBtn} onPress={startTrial} disabled={!!busy}>
          {busy === "trial" ? (
            <ActivityIndicator color={colors.onSurfaceTertiary} />
          ) : (
            <Text style={styles.trialText}>Start with free trial credits</Text>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>Billing is simulated in this preview build.</Text>
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
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 46, lineHeight: 46 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 23, marginTop: spacing.md, marginBottom: spacing.xl },
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
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: spacing.lg },
  planName: { color: colors.onSurface, fontFamily: font.display, fontSize: 32, letterSpacing: 1 },
  priceRow: { flexDirection: "row", alignItems: "baseline" },
  price: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  period: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  perkText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  selectBtn: { marginTop: spacing.lg, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  selectPrimary: { backgroundColor: colors.brandPrimary },
  selectGhost: { backgroundColor: colors.surfaceTertiary },
  selectText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  trialBtn: { alignItems: "center", paddingVertical: spacing.lg, marginTop: spacing.sm },
  trialText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base, textDecorationLine: "underline" },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.xs },
});
