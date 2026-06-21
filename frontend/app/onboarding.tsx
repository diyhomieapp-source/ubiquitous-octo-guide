import { View, Text, StyleSheet, Pressable, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1720036236697-018370867320?crop=entropy&cs=srgb&fm=jpg&w=1200&q=70";

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <ImageBackground source={{ uri: HERO }} style={styles.bg} resizeMode="cover">
        <LinearGradient
          colors={["rgba(18,18,18,0.35)", "rgba(18,18,18,0.85)", "rgba(18,18,18,0.98)"]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.content, { paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.badge}>
            <MaterialCommunityIcons name="hard-hat" size={16} color={colors.brandPrimary} />
            <Text style={styles.badgeText}>DIYHOMIE</Text>
          </View>

          <View style={{ flex: 1 }} />

          <Text style={styles.headline}>STOP{"\n"}SCROLLING.{"\n"}START{"\n"}BUILDING.</Text>
          <Text style={styles.sub}>
            Repairs, home improvements, maintenance or weatherproofing — DIYhomie guides you through every
            job one step at a time, with your local codes, your exact tools, and a custom photo for each move.
          </Text>

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
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  bg: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.xl },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderColor: colors.borderStrong,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  badgeText: { color: colors.onSurface, fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
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
