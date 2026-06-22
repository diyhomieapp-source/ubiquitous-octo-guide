import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { storage } from "@/src/utils/storage";

type Card = {
  key: string;
  question: string;
  multi?: boolean;
  kind?: "rating" | "value";
  subtitle?: string;
  options: { label: string; value: string; icon?: any; bg?: string }[];
};

type ToolKit = { key: string; title: string; blurb: string; icon: any; items: { label: string; icon: any }[] };
const TOOL_KITS: ToolKit[] = [
  {
    key: "essentials",
    title: "The Essentials",
    blurb: "Basics most homes already have",
    icon: "hammer",
    items: [
      { label: "Hammer", icon: "hammer" },
      { label: "Screwdriver Set", icon: "screwdriver" },
      { label: "Wrench", icon: "wrench" },
      { label: "Tape Measure", icon: "tape-measure" },
      { label: "Pliers", icon: "hammer-wrench" },
      { label: "Level", icon: "ruler-square" },
    ],
  },
  {
    key: "power",
    title: "Power Tools",
    blurb: "Plug-in & cordless muscle",
    icon: "hammer-screwdriver",
    items: [
      { label: "Cordless Drill", icon: "hammer-screwdriver" },
      { label: "Power Screwdriver", icon: "screwdriver" },
      { label: "Circular Saw", icon: "saw-blade" },
      { label: "Jigsaw", icon: "saw-blade" },
      { label: "Sander", icon: "vibrate" },
      { label: "Multimeter", icon: "gauge" },
    ],
  },
  {
    key: "pro",
    title: "Pro Gear",
    blurb: "For the serious builds",
    icon: "medal-outline",
    items: [
      { label: "Nail Gun", icon: "hammer" },
      { label: "Table Saw", icon: "saw-blade" },
      { label: "Angle Grinder", icon: "saw-blade" },
      { label: "Paint Sprayer", icon: "spray" },
      { label: "Tile Cutter", icon: "grid" },
      { label: "Stud Finder", icon: "magnet" },
    ],
  },
];

const CONFIDENCE = [
  { value: "Anxious", icon: "emoticon-sad-outline", label: "Anxious" },
  { value: "Unsure", icon: "emoticon-confused-outline", label: "Unsure" },
  { value: "Neutral", icon: "emoticon-neutral-outline", label: "Okay" },
  { value: "Capable", icon: "emoticon-happy-outline", label: "Capable" },
  { value: "Confident", icon: "emoticon-excited-outline", label: "Pumped" },
];

const CARDS: Card[] = [
  {
    key: "experience",
    question: "What's your comfort level with tools?",
    options: [
      { label: "Total Novice", value: "Total Novice", icon: "emoticon-confused-outline" },
      { label: "Weekend Warrior", value: "Weekend Warrior", icon: "tools" },
      { label: "Handy", value: "Handy", icon: "hammer-screwdriver" },
      { label: "Pro", value: "Pro", icon: "medal-outline" },
    ],
  },
  {
    key: "goals",
    question: "What are you itching to tackle?",
    subtitle: "Homie will tune every guide to what you care about.",
    multi: true,
    options: [
      { label: "Repairs & fixes", value: "Repairs", icon: "wrench-outline" },
      { label: "Upgrades & installs", value: "Upgrades", icon: "tools" },
      { label: "Paint & décor", value: "Paint & Decor", icon: "format-paint" },
      { label: "Outdoor & yard", value: "Outdoor", icon: "tree-outline" },
      { label: "Furniture & assembly", value: "Furniture", icon: "sofa-outline" },
      { label: "Save money vs hiring", value: "Save Money", icon: "cash-multiple" },
    ],
  },
  {
    key: "tools",
    question: "What's in your tool kit?",
    multi: true,
    options: [],
  },
  {
    key: "confidence",
    question: "How do home projects make you feel right now?",
    subtitle: "Be honest — Homie meets you exactly where you are.",
    kind: "rating",
    options: CONFIDENCE,
  },
  {
    key: "budget",
    question: "What's your project budget style?",
    options: [
      { label: "Budget Conscious / Value", value: "Budget Conscious", icon: "cash" },
      { label: "Standard / Reliable Brands", value: "Standard", icon: "shield-check-outline" },
      { label: "Premium / Top-Tier", value: "Premium", icon: "crown-outline" },
    ],
  },
  {
    key: "pain_point",
    question: "What frustrates you most about DIY guides?",
    multi: true,
    options: [
      { label: "Too confusing", value: "Too confusing", icon: "head-question-outline" },
      { label: "Missing steps", value: "Missing steps", icon: "format-list-checks" },
      { label: "Unexpected problems", value: "Unexpected problems", icon: "alert-octagon-outline" },
      { label: "Fear of breaking codes", value: "Fear of breaking codes", icon: "gavel" },
      { label: "None of the above", value: "None", icon: "close-circle-outline" },
    ],
  },
  {
    key: "value",
    question: "Here's why DIYhomie just clicks",
    kind: "value",
    options: [],
  },
  {
    key: "expectation",
    question: "What do you expect from your guide?",
    options: [
      { label: "Step-by-step hand-holding", value: "Step-by-step hand-holding", icon: "hand-heart-outline" },
      { label: "Fast code & permit verification", value: "Fast code & permit verification", icon: "file-certificate-outline" },
      { label: "A reliable troubleshooter", value: "A reliable troubleshooter", icon: "wrench-clock" },
    ],
  },
];

export default function Survey() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({ tools: [] });

  const card = CARDS[idx];

  const finish = async (final: Record<string, any>) => {
    await storage.setItem("diyhomie_pending_survey", JSON.stringify(final));
    router.replace("/analysis");
  };

  const advance = (next: Record<string, any>) => {
    if (idx < CARDS.length - 1) {
      setIdx(idx + 1);
    } else {
      finish(next);
    }
  };

  const onSelect = (value: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (card.multi) {
      const current: string[] = answers[card.key] || [];
      let updated: string[];
      if (value === "None") {
        updated = current.includes("None") ? [] : ["None"];
      } else {
        const base = current.filter((v) => v !== "None");
        updated = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
      }
      setAnswers({ ...answers, [card.key]: updated });
    } else {
      const next = { ...answers, [card.key]: value };
      setAnswers(next);
      advance(next);
    }
  };

  const continueMulti = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    advance(answers);
  };

  const toggleKit = (kit: ToolKit) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const current: string[] = answers.tools || [];
    const labels = kit.items.map((i) => i.label);
    const allOn = labels.every((l) => current.includes(l));
    const updated = allOn
      ? current.filter((l) => !labels.includes(l))
      : Array.from(new Set([...current, ...labels]));
    setAnswers({ ...answers, tools: updated });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.logoTop}><Logo size="sm" /></View>
      {/* progress */}
      <View style={styles.progressRow}>
        {CARDS.map((c, i) => (
          <View
            key={c.key}
            style={[styles.segment, { backgroundColor: i <= idx ? colors.brandPrimary : colors.surfaceTertiary }]}
          />
        ))}
      </View>

      <View style={styles.header}>
        {idx > 0 && (
          <Pressable testID="survey-back-button" onPress={() => setIdx(idx - 1)} hitSlop={12}>
            <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}
        <Text style={styles.stepLabel}>STEP {idx + 1} / {CARDS.length}</Text>
      </View>

      <Text style={styles.question} testID="survey-question">{card.question}</Text>
      {card.subtitle ? (
        <Text style={styles.subtitle}>{card.subtitle}</Text>
      ) : (
        card.multi && <Text style={styles.multiHint}>Select all that apply</Text>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {card.key === "tools" && (
          <View style={{ gap: spacing.lg }}>
            {TOOL_KITS.map((kit) => {
              const selected: string[] = answers.tools || [];
              const labels = kit.items.map((i) => i.label);
              const allOn = labels.every((l) => selected.includes(l));
              return (
                <View key={kit.key} style={styles.kitCard}>
                  <View style={styles.kitHead}>
                    <View style={styles.kitIcon}>
                      <MaterialCommunityIcons name={kit.icon} size={22} color={colors.brandPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kitTitle}>{kit.title}</Text>
                      <Text style={styles.kitBlurb}>{kit.blurb}</Text>
                    </View>
                    <Pressable
                      testID={`survey-kit-${kit.key}`}
                      onPress={() => toggleKit(kit)}
                      style={[styles.addAll, allOn && styles.addAllOn]}
                      hitSlop={8}
                    >
                      <MaterialCommunityIcons
                        name={allOn ? "check-all" : "plus"}
                        size={15}
                        color={allOn ? colors.onBrandPrimary : colors.brandPrimary}
                      />
                      <Text style={[styles.addAllText, allOn && { color: colors.onBrandPrimary }]}>
                        {allOn ? "Got it all" : "Add all"}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.tileGrid}>
                    {kit.items.map((item) => {
                      const on = selected.includes(item.label);
                      return (
                        <Pressable
                          key={item.label}
                          testID={`survey-option-${item.label}`}
                          onPress={() => onSelect(item.label)}
                          style={[styles.tile, on && styles.tileOn]}
                        >
                          <MaterialCommunityIcons
                            name={item.icon}
                            size={22}
                            color={on ? colors.onBrandPrimary : colors.onSurfaceSecondary}
                          />
                          <Text style={[styles.tileText, on && { color: colors.onBrandPrimary }]} numberOfLines={2}>
                            {item.label}
                          </Text>
                          {on && (
                            <View style={styles.tileCheck}>
                              <MaterialCommunityIcons name="check" size={11} color={colors.brandPrimary} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <Text style={styles.kitFootnote}>
              Tap a tile, or grab a whole set with “Add all”. Don’t have something? Just leave it off — Homie adapts.
            </Text>
          </View>
        )}
        {card.kind === "rating" && (
          <View style={styles.ratingRow}>
            {card.options.map((opt) => {
              const on = answers[card.key] === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  testID={`survey-option-${opt.value}`}
                  onPress={() => onSelect(opt.value)}
                  style={[styles.emojiTile, on && styles.emojiTileOn]}
                >
                  <MaterialCommunityIcons name={opt.icon} size={32} color={on ? colors.brandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.emojiLabel, on && { color: colors.onSurface }]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {card.kind === "value" && (
          <View style={{ gap: spacing.md }}>
            <View style={styles.valueBanner}>
              <MaterialCommunityIcons name="trending-up" size={22} color={colors.brandPrimary} />
              <Text style={styles.valueBannerText}>
                DIYers who plan first finish <Text style={styles.valueBold}>3x faster</Text> and dodge the costly do-overs.
              </Text>
            </View>
            <View style={styles.compareRow}>
              <View style={[styles.compareCol, styles.compareBad]}>
                <Text style={styles.compareHead}>GOING IT ALONE</Text>
                {["Hours lost in YouTube", "Guesswork & do-overs", "Surprise code issues", "Wasted material $$"].map((t) => (
                  <View key={t} style={styles.compareItem}>
                    <MaterialCommunityIcons name="close-circle" size={15} color={colors.error} />
                    <Text style={styles.compareText}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.compareCol, styles.compareGood]}>
                <Text style={[styles.compareHead, { color: colors.brandPrimary }]}>WITH DIYHOMIE</Text>
                {["Clear plan in seconds", "Built around your tools", "Code & weather aware", "Photos for every step"].map((t) => (
                  <View key={t} style={styles.compareItem}>
                    <MaterialCommunityIcons name="check-circle" size={15} color={colors.success} />
                    <Text style={styles.compareText}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>YOUR CONFIDENCE WITH HOMIE</Text>
              <View style={styles.chartBars}>
                {[28, 52, 76, 100].map((h, i) => (
                  <View key={i} style={styles.barCol}>
                    <View style={[styles.bar, { height: Math.max(8, (90 * h) / 100) }]} />
                    <Text style={styles.barLabel}>{["Now", "Wk 1", "Wk 2", "Wk 3"][i]}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {card.key !== "tools" && !card.kind && card.options.map((opt) => {
          const selected = card.multi
            ? (answers[card.key] || []).includes(opt.value)
            : answers[card.key] === opt.value;

          if (opt.bg) {
            return (
              <Pressable
                key={opt.value}
                testID={`survey-option-${opt.value}`}
                onPress={() => onSelect(opt.value)}
                style={[styles.photoCard, selected && styles.cardSelected]}
              >
                <ImageBackground source={{ uri: opt.bg }} style={styles.photoBg} resizeMode="cover">
                  <LinearGradient
                    colors={["rgba(18,18,18,0.15)", "rgba(18,18,18,0.92)"]}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.photoInner}>
                    <Text style={styles.photoLabel}>{opt.label}</Text>
                    <View style={[styles.check, selected && styles.checkOn]}>
                      {selected && <MaterialCommunityIcons name="check" size={18} color={colors.onBrandPrimary} />}
                    </View>
                  </View>
                </ImageBackground>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={opt.value}
              testID={`survey-option-${opt.value}`}
              onPress={() => onSelect(opt.value)}
              style={[styles.iconCard, selected && styles.cardSelected]}
            >
              <View style={styles.iconBox}>
                <MaterialCommunityIcons name={opt.icon} size={26} color={selected ? colors.brandPrimary : colors.onSurfaceSecondary} />
              </View>
              <Text style={[styles.iconLabel, selected && { color: colors.onSurface }]}>{opt.label}</Text>
              <MaterialCommunityIcons
                name={selected ? "radiobox-marked" : "chevron-right"}
                size={22}
                color={selected ? colors.brandPrimary : colors.onSurfaceTertiary}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      {(card.multi || card.kind === "value") && (
        <Pressable
          testID="survey-continue-button"
          style={[styles.continueBtn, { marginBottom: insets.bottom + spacing.md }]}
          onPress={continueMulti}
        >
          <Text style={styles.continueText}>{card.kind === "value" ? "I'M IN — CONTINUE" : "CONTINUE"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  logoTop: { marginBottom: spacing.lg },
  progressRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.lg },
  segment: { flex: 1, height: 5, borderRadius: radius.pill },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minHeight: 28 },
  stepLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1 },
  question: { color: colors.onSurface, fontFamily: font.display, fontSize: 38, lineHeight: 40, marginBottom: spacing.lg },
  iconCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  iconBox: {
    width: 48, height: 48, borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center",
  },
  iconLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.lg },
  cardSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  photoCard: { height: 110, borderRadius: radius.md, overflow: "hidden", borderWidth: 2, borderColor: colors.border },
  photoBg: { flex: 1, justifyContent: "flex-end" },
  photoInner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  photoLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  check: {
    width: 28, height: 28, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.onSurface,
    alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  continueBtn: {
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center",
  },
  continueText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  multiHint: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5, marginTop: -spacing.md, marginBottom: spacing.lg },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: -spacing.sm, marginBottom: spacing.lg },
  ratingRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs, marginTop: spacing.sm },
  emojiTile: { flex: 1, alignItems: "center", gap: spacing.xs, paddingVertical: spacing.lg, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md },
  emojiTileOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  emojiLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11 },
  valueBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg },
  valueBannerText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  valueBold: { color: colors.brandPrimary, fontFamily: font.bold },
  compareRow: { flexDirection: "row", gap: spacing.md },
  compareCol: { flex: 1, borderRadius: radius.md, borderWidth: 1.5, padding: spacing.md, gap: spacing.sm },
  compareBad: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  compareGood: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary },
  compareHead: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.xs },
  compareItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  compareText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chartCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg },
  chartTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.md },
  chartBars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", height: 110 },
  barCol: { alignItems: "center", gap: spacing.xs, flex: 1 },
  bar: { width: 26, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: colors.brandPrimary },
  barLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10 },
  kitCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg },
  kitHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  kitIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  kitTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  kitBlurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  addAll: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  addAllOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  addAllText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: { width: "31.5%", aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.xs, backgroundColor: colors.surfaceTertiary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md },
  tileOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tileText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11, textAlign: "center" },
  tileCheck: { position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.onBrandPrimary, alignItems: "center", justifyContent: "center" },
  kitFootnote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginTop: spacing.xs },
});
