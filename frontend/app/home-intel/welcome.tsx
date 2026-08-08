import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { track } from "@/src/utils/analytics";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Step = { key: string; label: string; done: boolean };
type Overview = { onboarding: { complete: boolean; steps: Step[]; progress: number } };

// Friendly copy + destination for each onboarding step.
const STEP_META: Record<string, { title: string; blurb: string; icon: any; route: string; cta: string }> = {
  profile: { title: "Tell us your DIY comfort", blurb: "So Homie pitches advice at just the right level.", icon: "account-wrench-outline", route: "/home-intel/account", cta: "Set experience" },
  property: { title: "Add your home details", blurb: "Type, year & size help tailor guidance and code checks.", icon: "home-edit-outline", route: "/home-intel/account", cta: "Add details" },
  rooms: { title: "Map your first room", blurb: "Snap a room so Homie understands your space.", icon: "floor-plan", route: "/home-intel/rooms", cta: "Map a room" },
  assets: { title: "Add a home asset", blurb: "Your appliances & systems unlock tailored, safe guidance.", icon: "cube-scan", route: "/home-intel/assets", cta: "Add an asset" },
};

export default function Welcome() {
  const router = useRouter();
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    try { setOv(await api<Overview>("/hi/account/overview")); } catch {} finally { setLoading(false); }
    track("welcome_viewed", { source: "banner" });
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const finish = async () => {
    setFinishing(true);
    try { await api("/hi/account/onboarding/complete", { method: "POST" }); } catch {}
    router.replace("/home-intel");
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Welcome" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const steps = ov?.onboarding.steps || [];
  const progress = ov?.onboarding.progress ?? 0;
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Welcome to Homie" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>{allDone ? "You're all set! 🎉" : "Let's set up your home"}</Text>
        <Text style={styles.sub}>{allDone ? "Nice work — Homie now knows your home and can tailor every answer." : "Four quick steps so Homie's advice fits your home perfectly."}</Text>

        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.progressLabel}>{doneCount} of {steps.length} done · {progress}%</Text>
        </View>

        {steps.map((s, i) => {
          const meta = STEP_META[s.key] || { title: s.label, blurb: "", icon: "circle-outline", route: "/home-intel/account", cta: "Do it" };
          const isNext = i === nextIdx;
          return (
            <View key={s.key} testID={`welcome-step-${s.key}`} style={[styles.step, s.done && styles.stepDone, isNext && styles.stepNext]}>
              <View style={[styles.stepIcon, s.done && styles.stepIconDone]}>
                <MaterialCommunityIcons name={s.done ? "check" : meta.icon} size={20} color={s.done ? colors.onBrandPrimary : colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepTitle, s.done && styles.stepTitleDone]}>{meta.title}</Text>
                {!s.done && <Text style={styles.stepBlurb}>{meta.blurb}</Text>}
                {s.done && <Text style={styles.stepDoneText}>Completed — nice!</Text>}
              </View>
              {!s.done && (
                <Pressable testID={`welcome-cta-${s.key}`} style={[styles.stepBtn, isNext && styles.stepBtnNext]} onPress={() => router.push(meta.route as any)}>
                  <Text style={[styles.stepBtnText, isNext && styles.stepBtnTextNext]}>{meta.cta}</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Pressable testID="welcome-finish" style={[styles.finishBtn, allDone && styles.finishBtnDone]} disabled={finishing} onPress={finish}>
          {finishing ? <ActivityIndicator color={allDone ? colors.onBrandPrimary : colors.onSurface} /> : (
            <Text style={[styles.finishText, allDone && styles.finishTextDone]}>{allDone ? "Start using Homie" : "Skip for now"}</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headline: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 4, lineHeight: 20 },
  progressWrap: { marginTop: spacing.lg, marginBottom: spacing.md },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  progressLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: 6 },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  stepDone: { opacity: 0.75 },
  stepNext: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  stepIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepIconDone: { backgroundColor: colors.success },
  stepTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  stepTitleDone: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  stepBlurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  stepDoneText: { color: colors.success, fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  stepBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stepBtnNext: { backgroundColor: colors.brandPrimary },
  stepBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  stepBtnTextNext: { color: colors.onBrandPrimary },
  finishBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, minHeight: 48, justifyContent: "center" },
  finishBtnDone: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  finishText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  finishTextDone: { color: colors.onBrandPrimary, fontFamily: font.bold },
});
