import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { SafetyCard, SafetyLevel } from "./SafetyCard";

/** Confidence label — non-color indicator (word + dots) plus color. */
export function ConfidenceLabel({ level }: { level: "low" | "medium" | "high" }) {
  const map = { low: { c: colors.warning, n: 1 }, medium: { c: colors.info, n: 2 }, high: { c: colors.success, n: 3 } };
  const m = map[level];
  return (
    <View style={styles.confRow} accessibilityLabel={`Confidence ${level}`}>
      <Text style={[styles.confText, { color: m.c }]}>{level} confidence</Text>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => <View key={i} style={[styles.dot, { backgroundColor: i < m.n ? m.c : colors.border }]} />)}
      </View>
    </View>
  );
}

type Section = { icon: string; title: string; body: string };

/**
 * Structured AI response — visually separates summary, safety, confidence,
 * reasoning, next action, tools, and source. Avoids one large paragraph.
 */
export function AIResponseCard({
  summary, safetyLevel, safetyMessage, confidence, sections, testID,
}: {
  summary: string;
  safetyLevel?: SafetyLevel;
  safetyMessage?: string;
  confidence?: "low" | "medium" | "high";
  sections?: Section[];
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.homieBadge}><MaterialCommunityIcons name="robot-happy-outline" size={16} color={colors.brandPrimary} /></View>
        <Text style={styles.summary}>{summary}</Text>
      </View>

      {confidence ? <ConfidenceLabel level={confidence} /> : null}

      {safetyLevel && safetyMessage ? (
        <SafetyCard level={safetyLevel} message={safetyMessage} testID={testID ? `${testID}-safety` : undefined} />
      ) : null}

      {(sections || []).map((s, i) => (
        <View key={i} style={styles.section}>
          <View style={styles.sectionHead}>
            <MaterialCommunityIcons name={s.icon as any} size={15} color={colors.onSurfaceTertiary} />
            <Text style={styles.sectionTitle}>{s.title}</Text>
          </View>
          <Text style={styles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  topRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  homieBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary + "22", alignItems: "center", justifyContent: "center" },
  summary: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  confRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  confText: { fontFamily: font.bold, fontSize: type.xs ?? 11, textTransform: "capitalize" },
  dots: { flexDirection: "row", gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  section: { gap: 2 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sectionTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
});
