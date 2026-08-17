import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, EmptyState } from "@/src/components/ui";

export const CATEGORY_LABELS: Record<string, string> = {
  water_moisture: "Water / Moisture",
  plumbing: "Plumbing",
  electrical_concern: "Electrical concern",
  appliance: "Appliance",
  hvac: "Heating / Cooling",
  drywall_interior_surface: "Drywall / Surface",
  doors_windows: "Doors / Windows",
  flooring: "Flooring",
  exterior: "Exterior",
  pest_unknown_condition: "Pest / Unknown",
  other_unsure: "Other / Not sure",
};

export const PHASE_LABELS: Record<string, string> = {
  ISSUE_REPORTED: "Reported",
  ASSESSMENT: "Assessed",
  INFORMATION_NEEDED: "Info needed",
  SAFE_INSPECTION: "Inspecting",
  PLAN_READY: "Plan ready",
  IN_PROGRESS: "In progress",
  BLOCKED_ESCALATED: "Needs a pro",
  VERIFICATION: "Verifying",
  COMPLETED: "Completed",
  DOCUMENTED: "Documented",
};

const RISK_COLOR: Record<string, string> = {
  normal: colors.success, caution: colors.warning, elevated: "#FF6A00", emergency_review: colors.error,
};

export default function RepairHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setIssues((await api<any>("/hi/repair/issues")).issues || []); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rp-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Guided Repair</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <View style={styles.hero}>
          <MaterialCommunityIcons name="robot-happy-outline" size={22} color={colors.brandPrimary} />
          <Text style={styles.heroText}>{"Tell me what's wrong in plain words. I'll figure out what's likely happening, what to check, and the safest next step — no guessing."}</Text>
        </View>
        <Button testID="rp-something-wrong" label="Something's wrong" icon="alert-decagram-outline" onPress={() => router.push("/home-intel/repair/new" as any)} />

        {loading ? <LoadingState /> : issues.length === 0 ? (
          <EmptyState icon="clipboard-pulse-outline" title="No repairs yet" message="When something breaks or looks off, start here. Every repair keeps its photos, decisions and outcome in your home record." />
        ) : (
          <>
            <Text style={styles.sectionTitle}>Your repairs</Text>
            {issues.map((i) => (
              <Pressable key={i.id} testID={`rp-issue-${i.id}`} style={styles.card} onPress={() => router.push(`/home-intel/repair/${i.id}` as any)}>
                <View style={styles.cardTop}>
                  <View style={[styles.dot, { backgroundColor: RISK_COLOR[i.triage?.risk_level] || colors.onSurfaceTertiary }]} />
                  <Text style={styles.cardTitle} numberOfLines={2}>{i.description || "Repair issue"}</Text>
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.chip}><Text style={styles.chipText}>{CATEGORY_LABELS[i.category] || i.category}</Text></View>
                  <View style={styles.chip}><Text style={styles.chipText}>{PHASE_LABELS[i.phase] || i.phase}</Text></View>
                  {i.urgency === "emergency_review" ? <View style={[styles.chip, { backgroundColor: colors.error + "22", borderColor: colors.error }]}><Text style={[styles.chipText, { color: colors.error }]}>Safety</Text></View> : null}
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  hero: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  heroText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  sectionTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 11 },
});
