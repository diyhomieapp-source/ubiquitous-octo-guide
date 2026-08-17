import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

/**
 * Doc 26 delta — lightweight "Did this help?" chips, linked to the exact context.
 */
export function FeedbackChips({ contextType, contextId, issueId, prompt }: {
  contextType: string; contextId?: string; issueId?: string; prompt?: string;
}) {
  const [sent, setSent] = useState<string | null>(null);

  const send = async (rating: string) => {
    setSent(rating);
    try { await api("/hi/feedback/submit", { method: "POST", body: { context_type: contextType, context_id: contextId, issue_id: issueId, rating } }); } catch {}
  };

  if (sent) return <Text style={styles.thanks}>Thanks — this helps Homie improve.</Text>;
  return (
    <View style={styles.row}>
      <Text style={styles.prompt}>{prompt || "Did this help?"}</Text>
      {[["yes", "Yes"], ["somewhat", "Somewhat"], ["no", "No"]].map(([k, label]) => (
        <Pressable key={k} testID={`fb-${contextType}-${k}`} onPress={() => send(k)} style={styles.chip}>
          <Text style={styles.chipText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.sm },
  prompt: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  chipText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  thanks: { fontFamily: font.regular, fontSize: type.sm, color: colors.success, marginTop: spacing.sm },
});
