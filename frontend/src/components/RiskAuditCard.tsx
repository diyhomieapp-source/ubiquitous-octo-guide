import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Factor = { key: string; label: string; level: "low" | "medium" | "high"; note: string };
type Audit = {
  risk_score: number; confidence: number; path_status: "optimal" | "caution" | "at_risk";
  factors: Factor[]; next_action: string; reschedule: string | null; summary: string;
};

const STATUS: Record<string, { label: string; color: string; icon: string }> = {
  optimal: { label: "Optimal path", color: colors.success, icon: "check-decagram" },
  caution: { label: "Proceed with care", color: colors.warning, icon: "alert-decagram" },
  at_risk: { label: "At risk", color: colors.error, icon: "close-octagon" },
};
const LEVEL: Record<string, string> = { low: colors.success, medium: colors.warning, high: colors.error };

export function RiskAuditCard({ projectId }: { projectId: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const run = useCallback(async (refresh = false) => {
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { setAudit(await api<Audit>(`/projects/${projectId}/audit${refresh ? "?refresh=1" : ""}`)); setOpen(true); }
    catch {} finally { setLoading(false); }
  }, [projectId]);

  if (!audit && !loading) {
    return (
      <Pressable testID="audit-run" style={styles.cta} onPress={() => run(false)}>
        <MaterialCommunityIcons name="radar" size={20} color={colors.brandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaTitle}>AI Risk & Critical-Path Audit</Text>
          <Text style={styles.ctaSub}>Check sequencing, safety & confidence for this project.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
      </Pressable>
    );
  }
  if (loading && !audit) return <View style={styles.cta}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.ctaSub}>  Analyzing your project…</Text></View>;

  const st = STATUS[audit!.path_status] || STATUS.caution;
  return (
    <View style={[styles.card, { borderColor: st.color }]}>
      <Pressable style={styles.head} onPress={() => setOpen((o) => !o)}>
        <MaterialCommunityIcons name={st.icon as any} size={22} color={st.color} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.status, { color: st.color }]}>{st.label}</Text>
          <Text style={styles.gauge}>Confidence {audit!.confidence}% · Risk {audit!.risk_score}%</Text>
        </View>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.onSurfaceTertiary} />
      </Pressable>

      {open && (
        <View style={styles.body}>
          <View style={styles.barBg}><View style={[styles.barFill, { width: `${audit!.confidence}%`, backgroundColor: st.color }]} /></View>
          <Text style={styles.summary}>{audit!.summary}</Text>

          {audit!.reschedule ? (
            <View style={styles.reschedule}>
              <MaterialCommunityIcons name="calendar-clock" size={16} color={colors.warning} />
              <Text style={styles.rescheduleText}>{audit!.reschedule}</Text>
            </View>
          ) : null}

          {audit!.factors.map((f, i) => (
            <View key={i} style={styles.factor}>
              <View style={[styles.dot, { backgroundColor: LEVEL[f.level] || colors.onSurfaceTertiary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.factorLabel}>{f.label} <Text style={[styles.factorLevel, { color: LEVEL[f.level] }]}>· {f.level}</Text></Text>
                <Text style={styles.factorNote}>{f.note}</Text>
              </View>
            </View>
          ))}

          <View style={styles.nextBox}>
            <MaterialCommunityIcons name="arrow-right-bold-circle" size={16} color={colors.brandPrimary} />
            <Text style={styles.nextText}>{audit!.next_action}</Text>
          </View>

          <Pressable testID="audit-refresh" style={styles.refresh} onPress={() => run(true)} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.refreshText}>Re-run audit</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  ctaTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  ctaSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  status: { fontFamily: font.bold, fontSize: type.base },
  gauge: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  body: { marginTop: spacing.sm, gap: spacing.sm },
  barBg: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  summary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  reschedule: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, backgroundColor: colors.warning + "18", borderRadius: radius.sm, padding: spacing.sm },
  rescheduleText: { flex: 1, color: colors.warning, fontFamily: font.medium, fontSize: type.sm },
  factor: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  factorLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  factorLevel: { fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  factorNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  nextBox: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm },
  nextText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  refresh: { alignSelf: "flex-start", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  refreshText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
