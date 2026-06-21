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
          <View style={styles.logoLockup}>
            <View style={styles.logoMark}>
              <MaterialCommunityIcons name="hard-hat" size={28} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.wordmark}>DIY<Text style={styles.wordmarkAccent}>homie</Text></Text>
          </View>

          <View style={{ flex: 1 }} />

          <Text style={styles.headline}>YOU'VE{"\n"}GOT THIS.</Text>
          <Text style={styles.sub}>
            That repair you've been putting off? Consider it handled. DIYhomie walks you through home repairs,
            improvements, maintenance and weatherproofing like a master contractor standing right beside you —
            one clear, confident step at a time.
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
  logoLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    alignSelf: "flex-start",
  },
  logoMark: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  wordmark: { color: colors.onSurface, fontFamily: font.bold, fontSize: 34, letterSpacing: -1 },
  wordmarkAccent: { color: colors.brandPrimary },
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
