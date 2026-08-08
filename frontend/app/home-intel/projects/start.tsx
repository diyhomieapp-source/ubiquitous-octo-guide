import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CATEGORIES = ["Fix Something", "Maintain Something", "Build Something", "Remodel a Space", "Improve My Yard", "Organize My Home"];
const SKILLS = ["Beginner", "Intermediate", "Advanced"];
const BUDGETS = ["Low", "Moderate", "Flexible"];
const TIMING = ["Today", "This Week", "Planning Ahead"];

export default function StartProject() {
  const router = useRouter();
  const { roomId, assetId } = useLocalSearchParams<{ roomId?: string; assetId?: string }>();
  const [goal, setGoal] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [skill, setSkill] = useState("Beginner");
  const [budget, setBudget] = useState("Moderate");
  const [timing, setTiming] = useState("This Week");
  const [tools, setTools] = useState("");
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<string | null>(null);

  const go = async () => {
    if (!goal.trim()) { Alert.alert("Describe your project", "Tell Homie what you'd like to do."); return; }
    setBusy(true); setClarify(null);
    try {
      const started = await api<any>("/hi/projects/start", { method: "POST", body: {
        goal: goal.trim(), project_category: category || undefined, room_id: roomId || undefined, asset_id: assetId || undefined,
      } });
      if (started.needs_clarification) { setClarify(started.clarifying_question); setBusy(false); return; }
      const pid = started.project.id;
      await api(`/hi/projects/${pid}/discovery`, { method: "PUT", body: {
        skill_level: skill, budget_preference: budget, timing_preference: timing, available_tools: tools.trim() || undefined,
      } });
      try {
        await api(`/hi/projects/${pid}/plan`, { method: "POST" });
        router.replace(`/home-intel/projects/${pid}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          Alert.alert("Safety first", "This looks unsafe for DIY. We recommend contacting a professional.", [
            { text: "OK", onPress: () => router.replace(`/home-intel/projects/${pid}`) }]);
        } else { throw e; }
      }
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert("Project limit reached", e.message, [
          { text: "Not now", style: "cancel" },
          { text: "See plans", onPress: () => router.push("/home-intel/upgrade") },
        ]);
      } else { Alert.alert("Couldn't start", e?.message || "Try again."); }
    }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Start a Project" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.q}>What would you like to do?</Text>
          <TextInput testID="proj-goal" style={styles.textArea} value={goal} onChangeText={setGoal} multiline textAlignVertical="top"
            placeholder="e.g. Build a floating shelf above my desk" placeholderTextColor={colors.onSurfaceTertiary} />
          {clarify && (
            <View style={styles.clarify}><MaterialCommunityIcons name="help-circle-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.clarifyText}>{clarify}</Text></View>
          )}

          <Group label="Type of project" options={CATEGORIES} value={category} onSelect={setCategory} testPrefix="proj-cat" />
          <Group label="Your skill level" options={SKILLS} value={skill} onSelect={setSkill} testPrefix="proj-skill" />
          <Group label="Budget" options={BUDGETS} value={budget} onSelect={setBudget} testPrefix="proj-budget" />
          <Group label="Timing" options={TIMING} value={timing} onSelect={setTiming} testPrefix="proj-timing" />

          <Text style={styles.label}>Tools you already have (optional)</Text>
          <TextInput testID="proj-tools" style={styles.input} value={tools} onChangeText={setTools} placeholder="e.g. drill, level, stud finder" placeholderTextColor={colors.onSurfaceTertiary} />

          <Pressable testID="proj-generate" style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={go}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Generate my plan</Text>}
          </Pressable>
          <Text style={styles.note}>Homie reviews safety first. Estimates are ranges, not guarantees.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Group({ label, options, value, onSelect, testPrefix }: { label: string; options: string[]; value: string | null; onSelect: (v: string) => void; testPrefix: string }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pressable key={o} testID={`${testPrefix}-${o}`} style={[styles.chip, value === o && styles.chipOn]} onPress={() => onSelect(o)}>
            <Text style={[styles.chipText, value === o && styles.chipTextOn]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  q: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"], marginBottom: spacing.md },
  textArea: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.lg, minHeight: 100 },
  clarify: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  clarifyText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 20 },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.sm },
});
