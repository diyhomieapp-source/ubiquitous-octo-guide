import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";
import { pickFromLibrary } from "@/src/utils/pickImage";

const TYPES = [
  { key: "room_refresh", label: "Room refresh", icon: "sofa-outline" },
  { key: "remodel_concept", label: "Remodel concept", icon: "hammer-wrench" },
  { key: "exterior", label: "Exterior", icon: "home-outline" },
  { key: "build_to_fit", label: "Build to fit", icon: "ruler-square" },
];
const FEELS = ["brighter", "more modern", "more organized", "more comfortable", "more functional", "easier to maintain"];

export default function DesignStudio() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ design_type: "room_refresh", title: "", objective: "", feel_goals: [], budget_range: "", source_photo_base64: null });

  const load = useCallback(async () => {
    try { const r = await api<any>("/hi/design-studio/projects"); setProjects(r.projects || []); }
    catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleFeel = (f: string) => setForm((s: any) => ({ ...s, feel_goals: s.feel_goals.includes(f) ? s.feel_goals.filter((x: string) => x !== f) : [...s.feel_goals, f] }));

  const addPhoto = async () => {
    const b64 = await pickFromLibrary("A photo of the actual space makes the concept room-aware.");
    if (b64) setForm((s: any) => ({ ...s, source_photo_base64: b64 }));
  };

  const create = async () => {
    if (!form.title.trim() || !form.objective.trim()) { Alert.alert("Give it a name and a plain-words goal."); return; }
    setBusy(true);
    try {
      const r = await api<any>("/hi/design-studio/projects", { method: "POST", body: form });
      setCreating(false);
      setForm({ design_type: "room_refresh", title: "", objective: "", feel_goals: [], budget_range: "", source_photo_base64: null });
      router.push(`/home-intel/design/${r.project.id}` as any);
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || ""); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="ds-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Design Studio</Text>
        <Pressable testID="ds-new" onPress={() => setCreating(!creating)} style={styles.iconBtn}><MaterialCommunityIcons name={creating ? "close" : "plus"} size={22} color={colors.brandPrimary} /></Pressable>
      </View>
      {loading ? <LoadingState /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {creating || !projects.length ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>See it before you build it</Text>
              <View style={styles.typeRow}>
                {TYPES.map((t) => (
                  <Pressable key={t.key} testID={`ds-type-${t.key}`} onPress={() => setForm((s: any) => ({ ...s, design_type: t.key }))} style={[styles.typeChip, form.design_type === t.key && styles.chipOn]}>
                    <MaterialCommunityIcons name={t.icon as any} size={15} color={form.design_type === t.key ? colors.onBrandTertiary : colors.onSurfaceSecondary} />
                    <Text style={[styles.chipText, form.design_type === t.key && { color: colors.onBrandTertiary }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput testID="ds-title" value={form.title} onChangeText={(v) => setForm((s: any) => ({ ...s, title: v }))} placeholder="Name it (e.g. Cozy living room)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <TextInput testID="ds-objective" value={form.objective} onChangeText={(v) => setForm((s: any) => ({ ...s, objective: v }))} multiline placeholder="What do you want this space to feel like — in your own words" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]} />
              <View style={styles.typeRow}>
                {FEELS.map((f) => (
                  <Pressable key={f} testID={`ds-feel-${f}`} onPress={() => toggleFeel(f)} style={[styles.typeChip, form.feel_goals.includes(f) && styles.chipOn]}>
                    <Text style={[styles.chipText, form.feel_goals.includes(f) && { color: colors.onBrandTertiary }]}>{f}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput testID="ds-budget" value={form.budget_range} onChangeText={(v) => setForm((s: any) => ({ ...s, budget_range: v }))} placeholder="Budget range (optional, e.g. $500–$1000)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <Pressable testID="ds-photo" onPress={addPhoto} style={styles.photoBtn}>
                <MaterialCommunityIcons name={form.source_photo_base64 ? "check-circle" : "camera-outline"} size={16} color={form.source_photo_base64 ? colors.success : colors.brandPrimary} />
                <Text style={styles.photoText}>{form.source_photo_base64 ? "Room photo added — concept will be room-aware" : "Add a photo of the space (optional)"}</Text>
              </Pressable>
              <Pressable testID="ds-create" onPress={create} style={styles.createBtn}>
                {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.createText}>Start designing</Text>}
              </Pressable>
            </View>
          ) : null}

          {projects.map((p) => (
            <Pressable key={p.id} testID={`ds-proj-${p.id}`} onPress={() => router.push(`/home-intel/design/${p.id}` as any)} style={styles.projCard}>
              <MaterialCommunityIcons name="palette-outline" size={20} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.projTitle}>{p.title}</Text>
                <Text style={styles.projMeta}>{p.design_type.replace(/_/g, " ")} · {p.status.replace(/_/g, " ")} · v{p.current_version}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontFamily: font.display, fontSize: type.xl, color: colors.onSurface, letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  formTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  chipText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: font.regular, fontSize: type.base },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  photoText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  createBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  createText: { fontFamily: font.bold, fontSize: type.base, color: colors.onBrandPrimary },
  projCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  projTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  projMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, textTransform: "capitalize" },
});
