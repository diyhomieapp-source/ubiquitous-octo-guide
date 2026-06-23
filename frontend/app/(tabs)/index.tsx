import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { BlueprintOverlay } from "@/src/components/BlueprintOverlay";
import { WeatherBanner } from "@/src/components/WeatherBanner";
import { AppMenu } from "@/src/components/AppMenu";

type ProjectSummary = { id: string; title: string; status: string; progress: number; total_steps: number; done_steps: number; has_guide: boolean };

const SUGGESTION_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<ProjectSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const suggestions = SUGGESTION_KEYS.map((k) => t(`suggestions.${k}`));

  const load = useCallback(async () => {
    try {
      const res = await api<ProjectSummary[]>("/projects");
      setActive(res.filter((p) => p.status === "active").slice(0, 3));
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const start = async (title: string) => {
    const t2 = title.trim();
    if (!t2 || creating) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreating(true);
    try {
      const proj = await api<{ id: string }>("/projects", { method: "POST", body: { title: t2, location: user?.location || "" } });
      await storage.setItem("diyhomie_active_project", proj.id);
      setInput("");
      router.push(`/project/${proj.id}?new=1`);
    } catch {} finally { setCreating(false); }
  };

  const openProject = async (p: ProjectSummary) => {
    await storage.setItem("diyhomie_active_project", p.id);
    router.push(`/project/${p.id}`);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <BlueprintOverlay />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={styles.logoRow}>
            <View style={styles.logoMark}><MaterialCommunityIcons name="hard-hat" size={20} color={colors.onBrandPrimary} /></View>
            <Text style={styles.wordmark}>DIY<Text style={{ color: colors.brandPrimary }}>homie</Text></Text>
          </View>
          <View style={styles.actions}>
            <View style={styles.creditPill}>
              <MaterialCommunityIcons name="lightning-bolt" size={13} color={colors.brandPrimary} />
              <Text style={styles.creditText}>{user?.credits ?? 0} {t("common.credits")}</Text>
            </View>
            <Pressable testID="home-notifications" style={styles.iconBtn} onPress={() => router.push("/notifications")} hitSlop={8}>
              <MaterialCommunityIcons name="bell-outline" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="home-menu" style={styles.iconBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
              <MaterialCommunityIcons name="menu" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.greeting}>{user?.name ? t("home.greetingNamed", { name: user.name.toUpperCase() }) : t("home.greeting")}{"\n"}{t("home.question")}</Text>
        <Text style={styles.subGreeting}>{t("home.subtitle")}</Text>

        <View style={styles.inputCard}>
          <TextInput
            testID="home-project-input"
            style={styles.input}
            placeholder={t("home.inputPlaceholder")}
            placeholderTextColor={colors.onSurfaceTertiary}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={() => start(input)}
          />
          <Pressable testID="home-start-button" style={[styles.startBtn, (!input.trim() || creating) && { opacity: 0.5 }]} onPress={() => start(input)} disabled={!input.trim() || creating}>
            {creating ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Text style={styles.startText}>{t("home.buildPlan")}</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
              </>
            )}
          </Pressable>
        </View>

        <View style={{ marginBottom: spacing.xl }}>
          <WeatherBanner location={user?.location} />
        </View>

        <Pressable testID="home-paint-studio" style={styles.paintBanner} onPress={() => router.push("/paint-studio")}>
          <View style={styles.paintIcon}><MaterialCommunityIcons name="format-paint" size={24} color={colors.onBrandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.paintTitle}>PAINT STUDIO</Text>
            <Text style={styles.paintSub}>Snap a room → see it in any color, instantly</Text>
          </View>
          <MaterialCommunityIcons name="arrow-right" size={22} color={colors.brandPrimary} />
        </Pressable>

        <Pressable testID="home-calculators" style={styles.calcBanner} onPress={() => router.push("/calculators")}>
          <View style={styles.calcIcon}><MaterialCommunityIcons name="calculator-variant-outline" size={22} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.calcTitle}>DIY CALCULATORS</Text>
            <Text style={styles.calcSub}>Know exactly how much material you need</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="home-maintenance" style={styles.calcBanner} onPress={() => router.push("/maintenance")}>
          <View style={styles.calcIcon}><MaterialCommunityIcons name="calendar-check-outline" size={22} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.calcTitle}>MAINTENANCE SCHEDULE</Text>
            <Text style={styles.calcSub}>Stay ahead of repairs & on budget</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.sectionLabel}>{t("home.popularProjects")}</Text>
        <View style={styles.suggestWrap}>
          {suggestions.map((s) => (
            <Pressable key={s} testID={`suggestion-${s}`} style={styles.suggestChip} onPress={() => start(s)}>
              <Text style={styles.suggestText}>{s}</Text>
            </Pressable>
          ))}
        </View>

        {active.length > 0 && (
          <>
            <View style={styles.continueHead}>
              <Text style={styles.sectionLabel}>{t("home.continue")}</Text>
              <Pressable testID="home-see-all" onPress={() => router.push("/(tabs)/projects")}>
                <Text style={styles.seeAll}>{t("common.seeAll")}</Text>
              </Pressable>
            </View>
            {active.map((p) => (
              <Pressable key={p.id} testID={`home-resume-${p.id}`} style={styles.resumeCard} onPress={() => openProject(p)}>
                <View style={styles.resumeIcon}><MaterialCommunityIcons name="play" size={18} color={colors.onBrandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resumeTitle} numberOfLines={1}>{p.title}</Text>
                  <View style={styles.resumeTrack}><View style={[styles.resumeFill, { width: `${p.progress}%` }]} /></View>
                </View>
                <Text style={styles.resumePct}>{p.progress}%</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xl },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoMark: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  wordmark: { color: colors.onSurface, fontFamily: font.bold, fontSize: 22, letterSpacing: -0.5 },
  creditPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  creditText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  greeting: { color: colors.onSurface, fontFamily: font.display, fontSize: 40, lineHeight: 40 },
  subGreeting: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 23, marginTop: spacing.sm, marginBottom: spacing.xl },
  inputCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1.5, padding: spacing.md, gap: spacing.md, marginBottom: spacing.xl },
  input: { minHeight: 56, maxHeight: 120, color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md },
  startText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.md },
  suggestWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xl },
  suggestChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  suggestText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  continueHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seeAll: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.md },
  resumeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm },
  resumeIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  resumeTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.xs },
  resumeTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  resumeFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  resumePct: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  paintBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xl },
  paintIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  paintTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  paintSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  calcBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xl },
  calcIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  calcTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  calcSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
});
