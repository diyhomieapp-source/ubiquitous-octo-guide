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
  options: { label: string; value: string; icon?: any; bg?: string }[];
};

type ToolCategory = { title: string; icon: any; items: string[] };
const TOOL_CATEGORIES: ToolCategory[] = [
  { title: "Hand Tools", icon: "hammer", items: ["Hammer", "Screwdriver Set", "Adjustable Wrench", "Pliers", "Tape Measure", "Utility Knife", "Spirit Level"] },
  { title: "Power Tools", icon: "screwdriver", items: ["Cordless Drill", "Impact Driver", "Circular Saw", "Jigsaw", "Angle Grinder", "Orbital Sander"] },
  { title: "Measure & Detect", icon: "ruler-square", items: ["Multimeter", "Stud Finder", "Laser Level"] },
  { title: "Plumbing", icon: "pipe-wrench", items: ["Pipe Wrench", "Plunger", "Hacksaw"] },
  { title: "Finishing", icon: "format-paint", items: ["Caulking Gun", "Putty Knife", "Paint Roller"] },
  { title: "Safety Gear", icon: "shield-check", items: ["Safety Glasses", "Work Gloves", "Dust Mask"] },
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
    key: "tools",
    question: "What's in your tool kit?",
    multi: true,
    options: [],
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
    ],
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
      const exists = current.includes(value);
      const updated = exists ? current.filter((v) => v !== value) : [...current, value];
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
      {card.multi && <Text style={styles.multiHint}>Select all that apply</Text>}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {card.key === "tools" && (
          <View style={{ gap: spacing.lg }}>
            {TOOL_CATEGORIES.map((cat) => (
              <View key={cat.title}>
                <View style={styles.toolCatHead}>
                  <MaterialCommunityIcons name={cat.icon} size={15} color={colors.brandPrimary} />
                  <Text style={styles.toolCatTitle}>{cat.title.toUpperCase()}</Text>
                </View>
                <View style={styles.toolGrid}>
                  {cat.items.map((item) => {
                    const selected = (answers.tools || []).includes(item);
                    return (
                      <Pressable
                        key={item}
                        testID={`survey-option-${item}`}
                        onPress={() => onSelect(item)}
                        style={[styles.toolChip, selected && styles.toolChipOn]}
                      >
                        {selected && <MaterialCommunityIcons name="check" size={13} color={colors.onBrandPrimary} />}
                        <Text style={[styles.toolChipText, selected && { color: colors.onBrandPrimary }]}>{item}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
        {card.key !== "tools" && card.options.map((opt) => {
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

      {card.multi && (
        <Pressable
          testID="survey-continue-button"
          style={[styles.continueBtn, { marginBottom: insets.bottom + spacing.md }]}
          onPress={continueMulti}
        >
          <Text style={styles.continueText}>CONTINUE</Text>
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
  toolCatHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  toolCatTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  toolGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  toolChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  toolChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toolChipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
});
