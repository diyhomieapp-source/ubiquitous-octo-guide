import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Switch } from "react-native";
import { useRouter } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const TYPES = ["procedure", "material", "tool", "maintenance_task", "symptom"];

export default function KnowledgeContribute() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [etype, setEtype] = useState("procedure");
  const [desc, setDesc] = useState("");
  const [sharePublic, setSharePublic] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !desc.trim()) { Alert.alert("Add details", "A title and description are required."); return; }
    setBusy(true);
    try {
      await api<any>("/hi/knowledge/contribute", { method: "POST", body: { title: title.trim(), entity_type: etype, description: desc.trim(), share_public: sharePublic } });
      Alert.alert(sharePublic ? "Submitted for review" : "Saved privately",
        sharePublic ? "Thanks! Our team will review it before it becomes public knowledge." : "Saved to your private knowledge.");
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Contribute knowledge" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.label}>Title</Text>
        <TextInput testID="kc-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. How I stained my deck" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={styles.label}>Type</Text>
        <View style={styles.wrap}>
          {TYPES.map((t) => (
            <Pressable key={t} style={[styles.chip, etype === t && styles.chipOn]} onPress={() => setEtype(t)}>
              <Text style={[styles.chipText, etype === t && { color: "#fff" }]}>{t.replace(/_/g, " ")}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>What did you learn?</Text>
        <TextInput testID="kc-desc" style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} multiline placeholder="Share the steps, tips or gotchas…" placeholderTextColor={colors.onSurfaceTertiary} />

        <View style={styles.shareRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shareTitle}>Share with the community</Text>
            <Text style={styles.shareSub}>Off = stays private to you. On = submitted for review before it can become public.</Text>
          </View>
          <Switch testID="kc-share" value={sharePublic} onValueChange={setSharePublic} trackColor={{ true: colors.brandPrimary }} />
        </View>

        <Pressable testID="kc-submit" style={styles.primary} disabled={busy} onPress={submit}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>{sharePublic ? "Submit for review" : "Save privately"}</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  shareRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  shareTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  shareSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
