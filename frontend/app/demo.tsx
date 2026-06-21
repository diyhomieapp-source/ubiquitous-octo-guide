import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator,
  Animated, Easing, KeyboardAvoidingView, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { api } from "@/src/api";

const SUGGESTIONS = [
  { label: "Fix a leaky faucet", icon: "water-pump" },
  { label: "Mount a TV on drywall", icon: "television" },
  { label: "Patch a hole in drywall", icon: "wall" },
  { label: "Unclog a slow drain", icon: "pipe-disconnected" },
  { label: "Replace a light fixture", icon: "ceiling-light" },
  { label: "Re-caulk a bathtub", icon: "format-paint" },
];

const LOADING_LINES = [
  "Sizing up the job…",
  "Checking your tool kit…",
  "Pulling local code requirements…",
  "Sequencing the steps…",
  "Drafting your visual…",
];

type Step = { id: string; index: number; title: string; instruction: string; visual_description: string };
type Guide = {
  overview: string;
  tools: string[];
  materials: string[];
  safety_warnings: string[];
  code_alert?: string | null;
};

export default function Demo() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<"pick" | "loading" | "result">("pick");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [loadingIdx, setLoadingIdx] = useState(0);

  const [guide, setGuide] = useState<Guide | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [heroImg, setHeroImg] = useState<string | null>(null);

  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== "loading") return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    const t = setInterval(() => setLoadingIdx((i) => (i + 1) % LOADING_LINES.length), 1400);
    return () => { loop.stop(); clearInterval(t); };
  }, [phase, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const generate = async (projectTitle: string) => {
    const t = projectTitle.trim();
    if (!t) { setError("Tell Homie what you want to tackle."); return; }
    setError("");
    setPhase("loading");
    setLoadingIdx(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const project = await api<any>("/projects", { method: "POST", body: { title: t } });
      const full = await api<any>(`/projects/${project.id}/guide`, { method: "POST" });
      setGuide(full.guide);
      const s: Step[] = full.steps || [];
      setSteps(s);
      setPhase("result");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Fire the hero image generation for step 1 in the background.
      if (s[0]) {
        api<{ image_base64: string }>(`/projects/${project.id}/step/${s[0].id}/image`, { method: "POST" })
          .then((r) => setHeroImg(r.image_base64))
          .catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || "Homie hit a snag. Try another project.");
      setPhase("pick");
    }
  };

  // ---------- PICK ----------
  if (phase === "pick") {
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoTop}><Logo size="sm" /></View>
          <View style={styles.freeTag}>
            <MaterialCommunityIcons name="gift-outline" size={14} color={colors.brandPrimary} />
            <Text style={styles.freeTagText}>FIRST GUIDE FREE</Text>
          </View>
          <Text style={styles.h1}>WHAT ARE WE{"\n"}FIXING TODAY?</Text>
          <Text style={styles.sub}>
            Pick a job or type your own. Homie builds a full, code-aware guide with visuals — right now, on the house.
          </Text>

          <TextInput
            testID="demo-input"
            style={styles.input}
            placeholder="e.g. Replace a kitchen faucet"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={title}
            onChangeText={setTitle}
            returnKeyType="go"
            onSubmitEditing={() => generate(title)}
          />
          {!!error && <Text testID="demo-error" style={styles.error}>{error}</Text>}

          <Text style={styles.orLabel}>POPULAR FIRST PROJECTS</Text>
          <View style={styles.chips}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s.label}
                testID={`demo-suggestion-${s.label}`}
                style={styles.chip}
                onPress={() => { setTitle(s.label); generate(s.label); }}
              >
                <MaterialCommunityIcons name={s.icon as any} size={16} color={colors.brandPrimary} />
                <Text style={styles.chipText}>{s.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable testID="demo-generate-button" style={styles.cta} onPress={() => generate(title)}>
            <MaterialCommunityIcons name="auto-fix" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.ctaText}>BUILD MY FREE GUIDE</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ---------- LOADING ----------
  if (phase === "loading") {
    return (
      <View style={[styles.root, styles.center]}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <MaterialCommunityIcons name="cog" size={56} color={colors.brandPrimary} />
        </Animated.View>
        <Text style={styles.loadingTitle}>HOMIE IS ON IT</Text>
        <Text style={styles.loadingLine}>{LOADING_LINES[loadingIdx]}</Text>
        <Text style={styles.loadingHint}>Building your first guide — this takes a few seconds.</Text>
      </View>
    );
  }

  // ---------- RESULT ----------
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.xl }}>
          <View style={styles.freeTag}>
            <MaterialCommunityIcons name="check-decagram" size={14} color={colors.success} />
            <Text style={[styles.freeTagText, { color: colors.success }]}>YOUR GUIDE IS READY</Text>
          </View>
          <Text style={styles.resultTitle}>{title}</Text>
          {!!guide?.overview && <Text style={styles.overview}>{guide.overview}</Text>}
        </View>

        {/* Hero visual */}
        <View style={styles.hero}>
          {heroImg ? (
            <Image source={{ uri: `data:image/png;base64,${heroImg}` }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.heroLoad}>Rendering your step visual…</Text>
            </View>
          )}
          <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>STEP 1 VISUAL</Text></View>
        </View>

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <Stat icon="format-list-numbered" value={`${steps.length}`} label="Steps" />
          <Stat icon="shield-alert-outline" value={`${guide?.safety_warnings?.length || 0}`} label="Safety" />
          <Stat icon="toolbox-outline" value={`${guide?.tools?.length || 0}`} label="Tools" />
        </View>

        {/* Safety / code alert */}
        {!!guide?.code_alert && (
          <View style={[styles.alert, { marginHorizontal: spacing.xl }]}>
            <MaterialCommunityIcons name="gavel" size={18} color={colors.warning} />
            <Text style={styles.alertText}>{guide.code_alert}</Text>
          </View>
        )}

        {/* Steps preview */}
        <Text style={styles.sectionLabel}>YOUR STEP-BY-STEP PLAN</Text>
        {steps.map((s, i) => {
          const locked = i >= 2;
          return (
            <View key={s.id} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{s.index}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                {locked ? (
                  <Text style={styles.stepLocked}>Unlock to reveal this step + visual</Text>
                ) : (
                  <Text style={styles.stepInstruction} numberOfLines={3}>{s.instruction}</Text>
                )}
              </View>
              {locked && <MaterialCommunityIcons name="lock" size={18} color={colors.onSurfaceTertiary} />}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.footerHint}>You just saw what Homie builds in seconds. Unlock unlimited guides, visuals & code checks.</Text>
        <Pressable testID="demo-unlock-button" style={styles.cta} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.replace("/paywall"); }}>
          <Text style={styles.ctaText}>UNLOCK FULL ACCESS</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  logoTop: { marginBottom: spacing.xl },
  freeTag: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start",
    backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginBottom: spacing.lg,
  },
  freeTagText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 48, lineHeight: 46 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 22, marginTop: spacing.md, marginBottom: spacing.xl },
  input: {
    backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg,
  },
  error: { color: colors.error, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.sm },
  orLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg + 2, borderRadius: radius.md,
    marginTop: spacing.xl,
  },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  // loading
  loadingTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 34, letterSpacing: 1, marginTop: spacing.xl },
  loadingLine: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.sm },
  loadingHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.xs },
  // result
  resultTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 38, lineHeight: 38, marginTop: spacing.xs },
  overview: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: spacing.md },
  hero: { height: 220, marginTop: spacing.lg, marginHorizontal: spacing.xl, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  heroLoad: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.sm },
  heroBadge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  heroBadgeText: { color: colors.onSurface, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  stat: { flex: 1, alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.lg },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  alert: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,196,0,0.1)", borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  alertText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, lineHeight: 19 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, paddingHorizontal: spacing.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.xl, marginBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg },
  stepNum: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  stepTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: 2 },
  stepInstruction: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  stepLocked: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  footerHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginBottom: spacing.md, lineHeight: 18 },
});
