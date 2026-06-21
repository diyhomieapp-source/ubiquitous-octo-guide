import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";

const HERO = require("../assets/hero-home.png");

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={styles.bg}>
        <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(18,18,18,0.05)", "rgba(18,18,18,0.65)", "rgba(18,18,18,0.98)"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.content, { paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.lg }]}>
          <Logo size="md" />

          <View style={{ flex: 1 }} />

          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowBar} />
            <Text style={styles.eyebrow}>REPAIR · MAINTAIN · IMPROVE</Text>
          </View>
          <Text style={styles.headline}>YOU’VE{"\n"}GOT THIS.</Text>
          <Text style={styles.sub}>
            Clear, step-by-step guides for home repairs, maintenance and improvement projects — built around your
            tools, your budget and your local codes. Like a master contractor right in your pocket.
          </Text>
          <View style={styles.pillsRow}>
            <View style={styles.pill}><MaterialCommunityIcons name="shield-check" size={14} color={colors.brandPrimary} /><Text style={styles.pillText}>Local codes</Text></View>
            <View style={styles.pill}><MaterialCommunityIcons name="wrench" size={14} color={colors.brandPrimary} /><Text style={styles.pillText}>Your tools</Text></View>
            <View style={styles.pill}><MaterialCommunityIcons name="gesture-tap" size={14} color={colors.brandPrimary} /><Text style={styles.pillText}>Interactive steps</Text></View>
          </View>

          <Pressable
            testID="onboarding-get-started-button"
            style={styles.cta}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/survey");
            }}
          >
            <Text style={styles.ctaText}>GET STARTED</Text>
            <MaterialCommunityIcons name="arrow-right" size={22} color={colors.onBrandPrimary} />
          </Pressable>

          <Pressable
            testID="onboarding-login-link"
            style={styles.loginRow}
            onPress={() => router.push("/auth?mode=login")}
          >
            <Text style={styles.loginText}>I already have an account</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  bg: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.xl },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  eyebrowBar: { width: 28, height: 4, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  eyebrow: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, letterSpacing: 1.5 },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,255,255,0.06)", borderColor: colors.borderStrong, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  pillText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  headline: {
    color: colors.onSurface,
    fontFamily: font.display,
    fontSize: 64,
    lineHeight: 60,
    letterSpacing: 1,
  },
  sub: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.regular,
    fontSize: type.lg,
    lineHeight: 24,
    marginTop: spacing.lg,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.lg + 2,
    borderRadius: radius.md,
    marginTop: spacing.xl,
  },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  loginRow: { alignItems: "center", paddingVertical: spacing.lg },
  loginText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
