import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button } from "@/src/components/ui";

const OUTCOMES = [
  { key: "resolved", label: "Resolved", icon: "check-circle-outline", hint: "The problem is fully fixed" },
  { key: "improved", label: "Improved & monitoring", icon: "trending-up", hint: "Better, but I'll keep an eye on it" },
  { key: "unresolved", label: "Still unresolved", icon: "alert-circle-outline", hint: "Not fixed — keep it active" },
  { key: "professionally_completed", label: "A pro finished it", icon: "account-hard-hat", hint: "Completed by a professional" },
  { key: "abandoned", label: "Abandoned", icon: "close-circle-outline", hint: "Stopping for now" },
];

export default function Closeout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [outcome, setOutcome] = useState("");
  const [work, setWork] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!outcome) { Alert.alert("Pick an outcome", "Let me know how this turned out."); return; }
    setBusy(true);
    try {
      await api(`/hi/repair/issues/${id}/complete`, {
        method: "POST",
        body: {
          outcome_status: outcome,
          resolved: ["resolved", "improved", "professionally_completed"].includes(outcome),
          work_performed: work.trim() || undefined,
          follow_up: followUp.trim() ? [followUp.trim()] : undefined,
          rating: rating || undefined,
        },
      });
      Alert.alert("Recorded", "This is now in your home record.");
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="cl-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Record outcome</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }}>
          <Text style={styles.hint}>{"\"Completed\" isn't always \"resolved\" — tell me what really happened so your record stays honest."}</Text>

          <View style={{ gap: spacing.sm }}>
            {OUTCOMES.map((o) => (
              <Pressable key={o.key} testID={`cl-outcome-${o.key}`} onPress={() => setOutcome(o.key)} style={[styles.optCard, outcome === o.key && styles.optActive]}>
                <MaterialCommunityIcons name={o.icon as any} size={22} color={outcome === o.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optLabel, outcome === o.key && { color: colors.brandPrimary }]}>{o.label}</Text>
                  <Text style={styles.optHint}>{o.hint}</Text>
                </View>
                {outcome === o.key ? <MaterialCommunityIcons name="check" size={20} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>What did you do? <Text style={styles.opt}>(optional)</Text></Text>
            <TextInput testID="cl-work" value={work} onChangeText={setWork} placeholder="e.g. Redirected the downspout away from the foundation" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Anything to monitor next? <Text style={styles.opt}>(optional)</Text></Text>
            <TextInput testID="cl-followup" value={followUp} onChangeText={setFollowUp} placeholder="e.g. Recheck the wall after the next heavy rain" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>How confident do you feel?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} testID={`cl-star-${n}`} onPress={() => setRating(n)}>
                  <MaterialCommunityIcons name={n <= rating ? "star" : "star-outline"} size={30} color={n <= rating ? colors.warning : colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          </View>

          <Button testID="cl-submit" label="Save to home record" icon="content-save-check-outline" loading={busy} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  hint: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  optCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  optActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  optLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  optHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12, marginTop: 1 },
  field: { gap: spacing.sm },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  opt: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12 },
  input: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 72, textAlignVertical: "top", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  stars: { flexDirection: "row", gap: spacing.sm },
});
