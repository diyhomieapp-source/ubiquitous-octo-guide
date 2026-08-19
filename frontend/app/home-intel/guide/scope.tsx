import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const SELECTIONS: { key: string; label: string; desc: string; icon: string }[] = [
  { key: "diy_all_safe", label: "I'll DIY Everything I Safely Can", desc: "You handle all DIY-friendly steps; pro-flagged steps stay marked for review", icon: "hand-heart-outline" },
  { key: "help_specific_parts", label: "I Want Help With Specific Parts", desc: "Pick exactly which steps a professional should handle", icon: "call-split" },
  { key: "pro_handles_it", label: "I Want a Professional to Handle This", desc: "Package the whole procedure as a professional request", icon: "account-hard-hat" },
];

const BUCKET_META: Record<string, { label: string; tone: string; icon: string }> = {
  diy_friendly: { label: "DIY-Friendly", tone: "#27AE60", icon: "check-circle-outline" },
  professional_recommended: { label: "Pro Recommended", tone: "#F2994A", icon: "alert-circle-outline" },
  professional_required: { label: "Pro Required", tone: "#EB5757", icon: "shield-alert-outline" },
};

export default function ScopeSplitter() {
  const { procedure_id } = useLocalSearchParams<{ procedure_id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<string | null>(null);
  const [proSteps, setProSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<any>(`/hi/proconnect/scope?procedure_id=${procedure_id}`);
      setData(res);
      if (res.saved_scope) {
        setSelection(res.saved_scope.selection);
        setProSteps(res.saved_scope.pro_step_ids || []);
      } else {
        setProSteps((res.steps || []).filter((s: any) => s.bucket !== "diy_friendly").map((s: any) => s.stepId));
      }
    } catch {} finally { setLoading(false); }
  }, [procedure_id]);
  useEffect(() => { load(); }, [load]);

  const toggleStep = (sid: string) => {
    if (selection !== "help_specific_parts") return;
    setProSteps((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  };

  const save = async () => {
    if (!selection) return;
    setBusy(true);
    try {
      const steps = data?.steps || [];
      const proIds = selection === "pro_handles_it" ? steps.map((s: any) => s.stepId)
        : selection === "diy_all_safe" ? steps.filter((s: any) => s.bucket !== "diy_friendly").map((s: any) => s.stepId)
        : proSteps;
      await api("/hi/proconnect/scope", { method: "PUT", body: { procedure_id, selection, pro_step_ids: proIds } });
      Alert.alert("Scope saved", selection === "pro_handles_it"
        ? "Use Bring In a Pro to send the full brief to a professional."
        : `Plan updated: ${steps.length - proIds.length} DIY steps, ${proIds.length} for a professional.`,
        [{ text: "OK", onPress: () => router.back() }]);
    } catch {} finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="DIY + Pro Split" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const steps = data?.steps || [];
  const effectiveProIds = selection === "pro_handles_it" ? steps.map((s: any) => s.stepId)
    : selection === "diy_all_safe" ? steps.filter((s: any) => s.bucket !== "diy_friendly").map((s: any) => s.stepId)
    : proSteps;

  return (
    <View style={styles.root}>
      <ScreenHeader title="DIY + Pro Split" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.hero}>{data?.procedure?.title}</Text>
        <Text style={styles.heroSub}>Homie classified each step by safety. Choose how you want to split the work — the plan updates accordingly.</Text>

        {SELECTIONS.map((o) => (
          <Pressable key={o.key} testID={`scope-${o.key}`} style={[styles.selRow, selection === o.key && styles.selRowActive]} onPress={() => setSelection(o.key)}>
            <MaterialCommunityIcons name={o.icon as any} size={22} color={selection === o.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selLabel}>{o.label}</Text>
              <Text style={styles.selDesc}>{o.desc}</Text>
            </View>
            <MaterialCommunityIcons name={selection === o.key ? "radiobox-marked" : "radiobox-blank"} size={20} color={selection === o.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
          </Pressable>
        ))}

        <Text style={styles.section}>Steps ({steps.length})</Text>
        {steps.map((s: any) => {
          const m = BUCKET_META[s.bucket] || BUCKET_META.diy_friendly;
          const assignedPro = effectiveProIds.includes(s.stepId);
          return (
            <Pressable key={s.stepId} testID={`scope-step-${s.stepId}`} style={styles.stepRow} onPress={() => toggleStep(s.stepId)}>
              <MaterialCommunityIcons name={m.icon as any} size={18} color={m.tone} />
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTask}>{s.task}</Text>
                <Text style={[styles.stepBucket, { color: m.tone }]}>{m.label}{s.reason ? ` — ${s.reason}` : ""}</Text>
              </View>
              <View style={[styles.assignChip, assignedPro ? styles.assignPro : styles.assignDiy]}>
                <Text style={[styles.assignText, { color: assignedPro ? colors.warning : colors.success }]}>{assignedPro ? "PRO" : "DIY"}</Text>
              </View>
            </Pressable>
          );
        })}
        {selection === "help_specific_parts" && <Text style={styles.hint}>Tap any step to flip it between DIY and PRO.</Text>}

        <Pressable testID="scope-save" style={[styles.primaryBtn, !selection && { opacity: 0.5 }]} disabled={!selection || busy} onPress={save}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Update Project Plan</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { ...type.heading, color: colors.onSurface },
  heroSub: { ...type.body, color: colors.onSurfaceTertiary, marginTop: spacing.xs, marginBottom: spacing.lg },
  selRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: "transparent", minHeight: 60 },
  selRowActive: { borderColor: colors.brandPrimary },
  selLabel: { ...type.button, fontSize: 14, color: colors.onSurface },
  selDesc: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
  section: { ...type.button, fontSize: 15, color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, minHeight: 56 },
  stepTask: { ...type.body, color: colors.onSurface },
  stepBucket: { ...type.caption, fontSize: 11, marginTop: 1 },
  assignChip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1 },
  assignPro: { borderColor: colors.warning + "88", backgroundColor: colors.warning + "14" },
  assignDiy: { borderColor: colors.success + "66", backgroundColor: colors.success + "10" },
  assignText: { ...type.caption, fontSize: 10 },
  hint: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: spacing.xs, textAlign: "center" },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.lg },
  primaryText: { ...type.button, color: colors.onBrandPrimary },
});
