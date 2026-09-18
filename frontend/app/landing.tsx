import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";

const DIY_BG = require("../assets/diy-bg.png");

export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const start = () => { Haptics.selectionAsync(); router.push("/survey"); };

  return (
    <View style={styles.root}>
      {/* layered DIY background: art faded into black + warm glow */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image source={DIY_BG} style={[StyleSheet.absoluteFill, { opacity: 0.28 }]} contentFit="cover" />
        <LinearGradient
          colors={["rgba(255,106,0,0.30)", "rgba(255,106,0,0.05)", "transparent"]}
          locations={[0, 0.35, 0.7]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(14,14,14,0.45)", "rgba(14,14,14,0.10)", "rgba(14,14,14,0.78)", "#0E0E0E"]}
          locations={[0, 0.38, 0.78, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inner}>
          <Logo size="lg" />

          <View style={styles.eyebrow}>
            <MaterialCommunityIcons name="hammer-screwdriver" size={14} color={colors.brandPrimary} />
            <Text style={styles.eyebrowText}>REPAIR · MAINTAIN · IMPROVE</Text>
          </View>

          <Text style={styles.h1}>DIY anything.{"\n"}Done right.</Text>

          <Text style={styles.sub}>
            Personalized, step-by-step guidance for every home repair and project — like a trusted contractor on call 24/7.
          </Text>

          <View style={styles.pills}>
            <View style={styles.pill}>
              <MaterialCommunityIcons name="check-decagram" size={14} color={colors.brandPrimary} />
              <Text style={styles.pillText}>Personalized guides</Text>
            </View>
            <View style={styles.pill}>
              <MaterialCommunityIcons name="gesture-tap" size={14} color={colors.brandPrimary} />
              <Text style={styles.pillText}>Step-by-step</Text>
            </View>
            <View style={styles.pill}>
              <MaterialCommunityIcons name="shield-check" size={14} color={colors.brandPrimary} />
              <Text style={styles.pillText}>Local codes</Text>
            </View>
          </View>

          <Pressable testID="landing-start" style={styles.primaryBtn} onPress={start}>
            <Text style={styles.primaryText}>Get started</Text>
          </Pressable>

          <Text style={styles.trust}>Free to start · No credit card</Text>

          <Pressable testID="landing-signin" style={styles.signin} onPress={() => router.push("/auth?mode=login")}>
            <Text style={styles.signinText}>I already have an account</Text>
          </Pressable>

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0E0E0E" },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  inner: { width: "100%", maxWidth: 480, alignSelf: "center", alignItems: "center" },

  eyebrow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,106,0,0.12)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderColor: "rgba(255,106,0,0.4)", borderWidth: 1, marginTop: spacing["2xl"] },
  eyebrowText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, letterSpacing: 1 },

  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 50, lineHeight: 50, textAlign: "center", marginTop: spacing.xl },
  sub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 26, textAlign: "center", marginTop: spacing.lg },

  primaryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing["2xl"], paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl, minWidth: 220, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.3 },
  trust: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md },

  pills: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,255,255,0.06)", borderColor: colors.borderStrong, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  pillText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  signin: { paddingVertical: spacing.md, marginTop: spacing.xs },
  signinText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
