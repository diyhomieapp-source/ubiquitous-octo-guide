import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const PREFS: { key: string; label: string; sub: string }[] = [
  { key: "community_review", label: "Submit for community review", sub: "Eligible for points after approval" },
  { key: "anonymous", label: "Share anonymously", sub: "Personal identifiers removed · eligible for review" },
  { key: "private", label: "Keep private", sub: "Saved to your history only · no points" },
];

export default function Contribute() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [pref, setPref] = useState("community_review");
  const [summary, setSummary] = useState("");
  const [lessons, setLessons] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ projects: any[] }>("/hi/rewards/contributable"); setProjects(d.projects); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!sel) { Alert.alert("Pick a project", "Choose a completed project to share."); return; }
    if (!summary.trim()) { Alert.alert("Add a summary", "Tell other homeowners what you did."); return; }
    setBusy(true);
    try {
      const res = await api<{ note: string }>("/hi/rewards/contributions", { method: "POST", body: { project_id: sel, sharing_preference: pref, summary: summary.trim(), lessons_learned: lessons.trim() || undefined } });
      Alert.alert("Submitted", res.note, [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Share a project" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.blurb}>Help another homeowner with a project you finished. You keep ownership of your content; points are pending until reviewed.</Text>
        <Text style={styles.label}>Completed project</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} /> :
          projects.length === 0 ? <Text style={styles.empty}>Finish a project first to share it here.</Text> :
            projects.map((p) => (
              <Pressable key={p.id} testID={`contrib-proj-${p.id}`} style={[styles.projRow, sel === p.id && styles.projOn]} onPress={() => !p.already_contributed && setSel(p.id)} disabled={p.already_contributed}>
                <MaterialCommunityIcons name={sel === p.id ? "radiobox-marked" : "radiobox-blank"} size={20} color={p.already_contributed ? colors.onSurfaceTertiary : colors.brandPrimary} />
                <View style={{ flex: 1 }}><Text style={[styles.projTitle, p.already_contributed && { color: colors.onSurfaceTertiary }]} numberOfLines={1}>{p.title}</Text><Text style={styles.projMeta}>{p.project_category}{p.already_contributed ? " · already shared" : ""}</Text></View>
              </Pressable>
            ))}

        <Text style={styles.label}>Sharing preference</Text>
        {PREFS.map((o) => (
          <Pressable key={o.key} testID={`pref-${o.key}`} style={[styles.prefRow, pref === o.key && styles.projOn]} onPress={() => setPref(o.key)}>
            <MaterialCommunityIcons name={pref === o.key ? "check-circle" : "circle-outline"} size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}><Text style={styles.projTitle}>{o.label}</Text><Text style={styles.projMeta}>{o.sub}</Text></View>
          </Pressable>
        ))}

        <Text style={styles.label}>Project summary</Text>
        <TextInput testID="contrib-summary" style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={summary} onChangeText={setSummary} placeholder="What you did, materials & tools used, rough cost & time…" placeholderTextColor={colors.onSurfaceTertiary} multiline />
        <Text style={styles.label}>Lessons learned (optional)</Text>
        <TextInput testID="contrib-lessons" style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={lessons} onChangeText={setLessons} placeholder="What you'd tell someone starting this…" placeholderTextColor={colors.onSurfaceTertiary} multiline />

        <Pressable testID="contrib-submit" style={styles.primary} disabled={busy} onPress={submit}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Submit</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  blurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.md },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  projRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  projOn: { borderColor: colors.brandPrimary },
  projTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  projMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
