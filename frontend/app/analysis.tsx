import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Animated, Easing } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { storage } from "@/src/utils/storage";

const EXP_LINE: Record<string, string> = {
  "Total Novice": "We'll treat you like a first-timer — patient, clear, zero assumptions.",
  "Weekend Warrior": "We'll keep it efficient and skip the obvious. You've got this.",
  "Handy": "We'll get technical when it counts and respect your skills.",
  "Pro": "We'll talk shop — codes, specs and pro shortcuts included.",
};

const PAIN_SOLUTIONS: Record<string, { icon: any; text: string }> = {
  "Too confusing": { icon: "head-check-outline", text: "Plain-English steps — zero jargon, ever." },
  "Missing steps": { icon: "format-list-checks", text: "Complete start-to-finish plans. Nothing skipped." },
  "Unexpected problems": { icon: "shield-alert-outline", text: "Built-in troubleshooting for every step." },
  "Fear of breaking codes": { icon: "gavel", text: "Local code & permit checks baked right in." },
};

type Survey = {
  experience?: string;
  tools?: string[];
  budget?: string;
  pain_point?: string[];
  expectation?: string;
};

function Reveal({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, translate, delay]);
  return <Animated.View style={{ opacity, transform: [{ translateY: translate }] }}>{children}</Animated.View>;
}

export default function Analysis() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [survey, setSurvey] = useState<Survey | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await storage.getItem<string>("diyhomie_pending_survey", "");
      try {
        setSurvey(raw ? JSON.parse(raw) : {});
      } catch {
        setSurvey({});
      }
    })();
  }, []);

  if (!survey) {
    return <View style={styles.root} />;
  }

  const tools = survey.tools || [];
  const pains = survey.pain_point || [];
  const expLine = EXP_LINE[survey.experience || ""] || "We'll tailor every guide to exactly how you work.";

  const proceed = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/auth?mode=register");
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.logoTop}><Logo size="sm" /></View>

        <Reveal delay={0}>
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowBar} />
            <Text style={styles.eyebrow}>PROFILE ANALYZED</Text>
          </View>
          <Text style={styles.headline}>WE GET YOU.</Text>
        </Reveal>

        {/* Superhuman contractor statement (NOT a match with a person) */}
        <Reveal delay={150}>
          <View style={styles.matchCard}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="account-hard-hat" size={32} color={colors.brandPrimary} />
            </View>
            <View style={styles.matchRight}>
              <Text style={styles.heroKicker}>YOUR DIY GUIDE IS A</Text>
              <Text style={styles.heroTitle}>SUPERHUMAN CONTRACTOR</Text>
              <Text style={styles.matchText}>
                Trained on every project from every angle — codes, pricing, methods, step-by-step, and fixes for whatever goes sideways.
              </Text>
            </View>
          </View>
        </Reveal>

        {/* Experience */}
        <Reveal delay={350}>
          <View style={styles.row}>
            <View style={styles.iconBox}><MaterialCommunityIcons name="account-wrench-outline" size={22} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{survey.experience || "Your level"}</Text>
              <Text style={styles.rowText}>{expLine}</Text>
            </View>
          </View>
        </Reveal>

        {/* Tools */}
        <Reveal delay={500}>
          <View style={styles.row}>
            <View style={styles.iconBox}><MaterialCommunityIcons name="toolbox-outline" size={22} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {tools.length > 0 ? `${tools.length} tool${tools.length > 1 ? "s" : ""} ready` : "We'll work with what you have"}
              </Text>
              <Text style={styles.rowText}>
                {tools.length > 0
                  ? "Every guide is built around exactly what's in your kit — and flags only what you're missing."
                  : "No tools? No problem. We'll suggest budget-friendly picks for each job."}
              </Text>
            </View>
          </View>
        </Reveal>

        {/* Pain points → solutions */}
        {pains.map((p, i) => {
          const sol = PAIN_SOLUTIONS[p];
          if (!sol) return null;
          return (
            <Reveal key={p} delay={650 + i * 150}>
              <View style={styles.row}>
                <View style={styles.iconBox}><MaterialCommunityIcons name={sol.icon} size={22} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowStrike}>{p}</Text>
                  <Text style={styles.rowText}>{sol.text}</Text>
                </View>
                <MaterialCommunityIcons name="check-decagram" size={20} color={colors.success} />
              </View>
            </Reveal>
          );
        })}

        <Reveal delay={650 + pains.length * 150 + 150}>
          <View style={styles.proofCard}>
            <MaterialCommunityIcons name="account-hard-hat" size={26} color={colors.brandPrimary} />
            <Text style={styles.proofText}>
              Your personal contractor is configured. Let's prove it — your first full guide is{" "}
              <Text style={styles.proofFree}>on the house.</Text>
            </Text>
          </View>
        </Reveal>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="analysis-continue-button" style={styles.cta} onPress={proceed}>
          <Text style={styles.ctaText}>MEET HOMIE</Text>
          <MaterialCommunityIcons name="arrow-right" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  logoTop: { marginBottom: spacing.xl },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  eyebrowBar: { width: 28, height: 4, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  eyebrow: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, letterSpacing: 1.5 },
  headline: { color: colors.onSurface, fontFamily: font.display, fontSize: 56, lineHeight: 54, letterSpacing: 1 },
  matchCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg,
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1.5,
    borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.lg,
  },
  heroIcon: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  heroKicker: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5, marginBottom: 2 },
  heroTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, lineHeight: 26, marginBottom: spacing.sm },
  matchRight: { flex: 1 },
  matchText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 21 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md,
  },
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: 2 },
  rowStrike: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.base, textDecorationLine: "line-through", marginBottom: 2 },
  rowText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19 },
  proofCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5,
    borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.sm,
  },
  proofText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, lineHeight: 21 },
  proofFree: { color: colors.brandPrimary, fontFamily: font.bold },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg + 2, borderRadius: radius.md,
  },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
});
