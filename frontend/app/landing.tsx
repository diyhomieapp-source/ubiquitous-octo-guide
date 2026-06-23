import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { DiyBackdrop } from "@/src/components/DiyBackdrop";

// Paste real store URLs here once the apps are published — buttons go live instantly.
const APP_STORE_URL = "";
const PLAY_STORE_URL = "";

export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const start = () => { Haptics.selectionAsync(); router.push("/onboarding"); };
  const openStore = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
    else start();
  };

  return (
    <View style={styles.root}>
      <DiyBackdrop />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inner}>
          <Logo width={150} />

          <View style={styles.eyebrow}>
            <MaterialCommunityIcons name="hammer-screwdriver" size={14} color={colors.brandPrimary} />
            <Text style={styles.eyebrowText}>REPAIR · MAINTAIN · IMPROVE</Text>
          </View>

          <Text style={styles.h1}>Fix it. Build it.{"\n"}Do it right.</Text>

          <Text style={styles.sub}>
            Personalized, step-by-step guidance for every home repair and project — like a trusted contractor on call 24/7.
          </Text>

          <Pressable testID="landing-start" style={styles.primaryBtn} onPress={start}>
            <Text style={styles.primaryText}>Start free</Text>
          </Pressable>

          <Text style={styles.trust}>Free to start · No credit card</Text>

          <View style={styles.badges}>
            <Pressable testID="badge-appstore" style={styles.badge} onPress={() => openStore(APP_STORE_URL)}>
              <MaterialCommunityIcons name="apple" size={26} color="#fff" />
              <View>
                <Text style={styles.badgeSmall}>Download on the</Text>
                <Text style={styles.badgeBig}>App Store</Text>
              </View>
            </Pressable>
            <Pressable testID="badge-playstore" style={styles.badge} onPress={() => openStore(PLAY_STORE_URL)}>
              <MaterialCommunityIcons name="google-play" size={22} color="#fff" />
              <View>
                <Text style={styles.badgeSmall}>GET IT ON</Text>
                <Text style={styles.badgeBig}>Google Play</Text>
              </View>
            </Pressable>
          </View>
          <Text style={styles.badgeNote}>iOS & Android coming soon</Text>
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

  primaryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing["2xl"], paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing["2xl"], minWidth: 220, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.3 },
  trust: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md },

  badges: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.md, marginTop: spacing["2xl"] },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#000", borderColor: "#333", borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minWidth: 150 },
  badgeSmall: { color: "#bbb", fontFamily: font.medium, fontSize: 10, letterSpacing: 0.5 },
  badgeBig: { color: "#fff", fontFamily: font.bold, fontSize: type.lg, marginTop: -1 },
  badgeNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md },
});
