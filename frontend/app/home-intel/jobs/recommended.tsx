import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { track } from "@/src/utils/analytics";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function ProfessionalRecommended() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string; risk?: string; title?: string; project_id?: string; asset_id?: string; description?: string }>();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState((params.title as string) || "");
  const [description, setDescription] = useState((params.description as string) || "");

  // Log that escalation was shown (once per mount).
  useEffect(() => { track("professional_escalation_shown", { source: (params.source as string) || "manual", risk_level: (params.risk as string) || "elevated" }); }, []);

  const createSummary = async () => {
    if (!title.trim()) { Alert.alert("Add a title", "Give this job a short title so a pro knows what it's about."); return; }
    setBusy(true);
    try {
      const job = await api<{ id: string }>("/hi/jobs", {
        method: "POST",
        body: {
          title: title.trim(), description: description.trim(),
          source: (params.source as string) || "manual",
          project_id: params.project_id, asset_id: params.asset_id,
        },
      });
      router.replace(`/home-intel/jobs/${job.id}`);
    } catch (e: any) {
      Alert.alert("Couldn't create summary", e?.message || "Try again.");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Professional recommended" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.hero}>
          <MaterialCommunityIcons name="shield-alert-outline" size={30} color={colors.warning} />
          <Text style={styles.heroTitle}>This looks like a job for a professional</Text>
        </View>

        <View style={styles.emergency}>
          <MaterialCommunityIcons name="alert-octagon" size={18} color="#EB5757" />
          <Text style={styles.emergencyText}>If this is an emergency (gas, fire, flooding, sparking, or anyone is in danger), stop and call your local emergency services first. Don&apos;t wait to make a summary.</Text>
        </View>

        <Text style={styles.section}>Why we suggest a pro</Text>
        <Text style={styles.body}>Based on what you&apos;ve described, this may involve safety, code, or specialised tools beyond a comfortable DIY level. A qualified professional can assess it safely.</Text>

        <Text style={styles.section}>What to avoid for now</Text>
        {["Don't operate or relight the affected system", "Don't remove permanent fixtures or wiring", "Keep the area clear and ventilated if relevant"].map((t) => (
          <View key={t} style={styles.avoidRow}><MaterialCommunityIcons name="close-circle-outline" size={16} color="#EB5757" /><Text style={styles.avoidText}>{t}</Text></View>
        ))}

        <Text style={styles.section}>Start a job summary</Text>
        <Text style={styles.label}>Title</Text>
        <TextInput testID="rec-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Leaking water heater" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.label}>What&apos;s happening?</Text>
        <TextInput testID="rec-desc" style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={description} onChangeText={setDescription} placeholder="Describe what you're seeing (no need for personal details)" placeholderTextColor={colors.onSurfaceTertiary} multiline />

        <Pressable testID="rec-create" style={styles.primary} disabled={busy} onPress={createSummary}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Create job summary</Text>}
        </Pressable>
        <Pressable testID="rec-return" style={styles.ghost} onPress={() => router.replace("/home-intel")}>
          <Text style={styles.ghostText}>Return home</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  heroTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, textAlign: "center" },
  emergency: { flexDirection: "row", gap: spacing.sm, backgroundColor: "#EB575718", borderColor: "#EB575755", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  emergencyText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 19 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.xs },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  avoidRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  avoidText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  ghost: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  ghostText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
