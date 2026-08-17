import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button } from "@/src/components/ui";
import { CATEGORY_LABELS } from "./index";

const URGENCIES = [
  { key: "whenever", label: "Whenever" },
  { key: "soon", label: "Fairly soon" },
  { key: "urgent", label: "Urgent" },
];

export default function NewRepair() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other_unsure");
  const [urgency, setUrgency] = useState("soon");
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<any>(null);

  const pickCategory = async (key: string) => {
    setCategory(key);
    try {
      const c = await api<any>("/hi/record/context", { method: "POST", body: { category: key, description: description.trim() || undefined } });
      setCtx(c?.has_context ? c : null);
    } catch { setCtx(null); }
  };

  const submit = async (isDraft: boolean) => {
    if (!description.trim()) { Alert.alert("Tell me what's happening", "Even one sentence helps, e.g. 'There is water coming through my basement wall.'"); return; }
    setBusy(true);
    try {
      const res = await api<any>("/hi/repair/issues", { method: "POST", body: { description: description.trim(), category, urgency, is_draft: isDraft } });
      router.replace(`/home-intel/repair/${res.issue.id}` as any);
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rpn-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{"What's wrong?"}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }}>
          <View style={styles.card}>
            <Text style={styles.label}>Describe it in your own words</Text>
            <TextInput
              testID="rpn-description"
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. There's a damp stain spreading near the bottom of my basement wall"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              multiline
            />
          </View>

          <View>
            <Text style={styles.label}>What area is it? <Text style={styles.hint}>{'(pick the closest — "Not sure" is fine)'}</Text></Text>
            <View style={styles.wrap}>
              {Object.entries(CATEGORY_LABELS).map(([key, lbl]) => (
                <Pressable key={key} testID={`rpn-cat-${key}`} onPress={() => pickCategory(key)} style={[styles.pill, category === key && styles.pillActive]}>
                  <Text style={[styles.pillText, category === key && styles.pillTextActive]}>{lbl}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text style={styles.label}>How soon does it need attention?</Text>
            <View style={styles.wrap}>
              {URGENCIES.map((u) => (
                <Pressable key={u.key} testID={`rpn-urg-${u.key}`} onPress={() => setUrgency(u.key)} style={[styles.pill, urgency === u.key && styles.pillActive]}>
                  <Text style={[styles.pillText, urgency === u.key && styles.pillTextActive]}>{u.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {ctx ? (
            <View style={styles.ctxCard}>
              <MaterialCommunityIcons name="history" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.ctxTitle}>Homie remembers this area</Text>
                <Text style={styles.ctxText}>{ctx.homie_note}</Text>
                {ctx.prior_projects?.length ? <Text style={styles.ctxMeta}>{ctx.prior_projects.length} related project{ctx.prior_projects.length > 1 ? "s" : ""} on record</Text> : null}
              </View>
            </View>
          ) : null}

          <Button testID="rpn-submit" label="Get help" icon="arrow-right" loading={busy} onPress={() => submit(false)} />
          <Pressable testID="rpn-draft" onPress={() => submit(true)} disabled={busy} style={styles.draftBtn}>
            <Text style={styles.draftText}>Save as draft for later</Text>
          </Pressable>
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
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.sm },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12 },
  input: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 96, textAlignVertical: "top", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 13 },
  pillTextActive: { color: colors.onBrandPrimary },
  draftBtn: { alignItems: "center", paddingVertical: spacing.sm },
  draftText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base, textDecorationLine: "underline" },
  ctxCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  ctxTitle: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  ctxText: { color: colors.onSurface, fontFamily: font.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  ctxMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11, marginTop: 4 },
});
