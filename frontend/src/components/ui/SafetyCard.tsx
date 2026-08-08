import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type, safety } from "@/src/theme";

export type SafetyLevel = "safe" | "verify" | "stop" | "emergency";

/**
 * Consistent safety treatment used across Homie, Projects, AR, Maintenance,
 * Professional handoff and Emergency Mode. Status is always shown with an
 * icon + text label, never color alone (accessibility requirement).
 */
export function SafetyCard({
  level, title, message, children, testID,
}: {
  level: SafetyLevel;
  title?: string;
  message: string;
  children?: React.ReactNode;
  testID?: string;
}) {
  const s = safety[level];
  const emphatic = level === "stop" || level === "emergency";
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={`${s.label}. ${message}`}
      style={[
        styles.card,
        { borderColor: s.color, backgroundColor: s.color + (emphatic ? "22" : "14") },
        emphatic && styles.emphatic,
      ]}
    >
      <View style={styles.header}>
        <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
        <Text style={[styles.label, { color: s.color }]}>{title || s.label}</Text>
      </View>
      <Text style={styles.message}>{message}</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  emphatic: { borderLeftWidth: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { fontFamily: font.bold, fontSize: type.base, textTransform: "uppercase", letterSpacing: 0.5 },
  message: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
});
