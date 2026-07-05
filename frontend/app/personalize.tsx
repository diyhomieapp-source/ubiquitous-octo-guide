import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Prefs = Record<string, any>;
type Preset = { id: string; label: string; icon: string };

const SECTIONS: { key: string; label: string; icon: string }[] = [
  { key: "avatar_gender", label: "Avatar", icon: "account-outline" },
  { key: "avatar_look", label: "Personality", icon: "emoticon-outline" },
  { key: "avatar_gear", label: "Gear", icon: "hard-hat" },
  { key: "voice", label: "Voice style", icon: "microphone-outline" },
  { key: "verbosity", label: "Guidance detail", icon: "text-box-outline" },
  { key: "overlay_palette", label: "AR overlay palette", icon: "palette-outline" },
  { key: "highlight_style", label: "AR highlight style", icon: "cursor-default-outline" },
  { key: "text_size", label: "Text size", icon: "format-size" },
  { key: "cue_speed", label: "Animation speed", icon: "speedometer" },
  { key: "theme", label: "App theme", icon: "brush-variant" },
  { key: "notification_sound", label: "Notification sound", icon: "bell-outline" },
];

export default function Personalize() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [options, setOptions] = useState<Record<string, any>>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ preferences: Prefs; options: any; presets: Preset[] }>("/preferences"); setPrefs(d.preferences); setOptions(d.options); setPresets(d.presets); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setPref = async (key: string, value: any) => {
    setPrefs((p) => ({ ...(p || {}), [key]: value, preset: null }));
    Haptics.selectionAsync();
    try { const d = await api<{ preferences: Prefs }>("/preferences", { method: "PUT", body: { [key]: value } }); setPrefs(d.preferences); } catch {}
  };
  const applyPreset = async (id: string) => {
    setSaving(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { const d = await api<{ preferences: Prefs }>(`/preferences/preset/${id}`, { method: "POST" }); setPrefs(d.preferences); } catch {} finally { setSaving(false); }
  };
  const reset = async () => {
    try { const d = await api<{ preferences: Prefs }>("/preferences/reset", { method: "POST" }); setPrefs(d.preferences); } catch {}
  };

  if (loading || !prefs) return <View style={styles.rootCenter}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="pz-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Personalize</Text>
        <Pressable testID="pz-reset" hitSlop={10} onPress={() => Alert.alert("Reset to defaults?", "This restores all avatar & display settings.", [{ text: "Cancel", style: "cancel" }, { text: "Reset", style: "destructive", onPress: reset }])}><MaterialCommunityIcons name="restore" size={22} color={colors.onSurfaceTertiary} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        {/* Avatar preview */}
        <View style={styles.preview}>
          <View style={[styles.avatarCircle, { backgroundColor: prefs.avatar_skin }]}>
            <MaterialCommunityIcons name={prefs.avatar_gear === "Hard hat" ? "hard-hat" : prefs.avatar_gear === "Safety vest" ? "shield-account" : "account"} size={40} color={colors.surface} />
          </View>
          <Text style={styles.previewName}>{prefs.avatar_look} · {prefs.avatar_gender}</Text>
          <Text style={styles.previewSub}>{prefs.voice} voice · {prefs.verbosity} guidance</Text>
        </View>

        {/* Presets */}
        <Text style={styles.section}>Quick styles</Text>
        <View style={styles.presetRow}>
          {presets.map((p) => (
            <Pressable key={p.id} testID={`pz-preset-${p.id}`} style={[styles.preset, prefs.preset === p.id && styles.presetOn]} onPress={() => applyPreset(p.id)} disabled={saving}>
              <MaterialCommunityIcons name={p.icon as any} size={22} color={prefs.preset === p.id ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.presetText, prefs.preset === p.id && { color: colors.onBrandPrimary }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* JIT coaching toggle */}
        <Pressable testID="pz-jit" style={styles.toggleRow} onPress={() => setPref("jit_coaching", !prefs.jit_coaching)}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={styles.toggleLabel}>Just-in-time coaching</Text><Text style={styles.toggleSub}>Proactive tips during multi-step tasks</Text></View>
          <View style={[styles.switch, prefs.jit_coaching && styles.switchOn]}><View style={[styles.knob, prefs.jit_coaching && styles.knobOn]} /></View>
        </Pressable>

        {/* Option sections */}
        {SECTIONS.map((s) => (
          <View key={s.key} style={styles.optBlock}>
            <View style={styles.optHead}><MaterialCommunityIcons name={s.icon as any} size={16} color={colors.onSurfaceSecondary} /><Text style={styles.optLabel}>{s.label}</Text></View>
            <View style={styles.chipWrap}>
              {(options[s.key] || []).map((opt: string) => {
                const active = prefs[s.key] === opt;
                const isColor = s.key === "avatar_skin";
                return (
                  <Pressable key={opt} testID={`pz-${s.key}-${opt}`} onPress={() => setPref(s.key, opt)}
                    style={[isColor ? styles.swatch : styles.chip, isColor && { backgroundColor: opt }, active && (isColor ? styles.swatchOn : styles.chipOn)]}>
                    {!isColor && <Text style={[styles.chipText, active && styles.chipTextOn]}>{opt}</Text>}
                    {isColor && active && <MaterialCommunityIcons name="check" size={16} color="#fff" />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.note}>
          <MaterialCommunityIcons name="information-outline" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.noteText}>Theme, text size, guidance detail & sounds apply across the app. Live AR overlays and spoken avatar voice render in the native build of DIYhomie.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  rootCenter: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  preview: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", borderColor: colors.brandPrimary, borderWidth: 2 },
  previewName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xs },
  previewSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  preset: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1 },
  presetOn: { backgroundColor: colors.brandPrimary },
  presetText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  toggleLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  toggleSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.brandPrimary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  optBlock: { marginTop: spacing.lg },
  optHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  optLabel: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 13 },
  chipTextOn: { color: colors.onBrandPrimary },
  swatch: { width: 40, height: 40, borderRadius: 20, borderColor: colors.border, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  swatchOn: { borderColor: colors.onSurface, borderWidth: 3 },
  note: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md },
  noteText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
});
