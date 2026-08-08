import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const TYPES: { key: string; label: string }[] = [
  { key: "feature_request", label: "Feature request" },
  { key: "bug_report", label: "Bug report" },
  { key: "general_feedback", label: "General feedback" },
];

export default function FeedbackScreen() {
  const router = useRouter();
  const [ftype, setFtype] = useState("general_feedback");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !desc.trim()) { Alert.alert("Add details", "A title and description help us review it."); return; }
    setBusy(true);
    try {
      await api("/hi/rewards/feedback", { method: "POST", body: { feedback_type: ftype, title: title.trim(), description: desc.trim() } });
      Alert.alert("Thanks!", "Eligible reports are reviewed before any points are awarded.", [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Feedback &amp; bugs" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.blurb}>Help us improve DIYhomie. We don&apos;t promise points automatically — eligible reports enter review and are approved by our team.</Text>
        <Text style={styles.label}>Type</Text>
        <View style={styles.chipRow}>
          {TYPES.map((t) => (
            <Pressable key={t.key} testID={`fb-type-${t.key}`} style={[styles.chip, ftype === t.key && styles.chipOn]} onPress={() => setFtype(t.key)}>
              <Text style={[styles.chipText, ftype === t.key && { color: "#fff" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Title</Text>
        <TextInput testID="fb-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Short summary" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.label}>Details</Text>
        <TextInput testID="fb-desc" style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} placeholder="What happened / what would you like?" placeholderTextColor={colors.onSurfaceTertiary} multiline />
        <Pressable testID="fb-submit" style={styles.primary} disabled={busy} onPress={submit}>
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
