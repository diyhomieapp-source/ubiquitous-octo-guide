import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Settings = {
  language: string; reading_level: string; simplified_mode: boolean; text_size: string;
  voice_guidance: boolean; high_contrast: boolean; reduce_motion: boolean;
};
type Meta = { languages: { code: string; label: string }[]; reading_levels: string[]; text_sizes: string[] };

const RL_LABEL: Record<string, string> = { simple: "Simple", standard: "Standard", detailed: "Detailed" };
const RL_HINT: Record<string, string> = {
  simple: "Short sentences, everyday words, jargon explained.",
  standard: "Balanced explanations for most homeowners.",
  detailed: "Thorough steps with the why behind each one.",
};
const TS_LABEL: Record<string, string> = { standard: "Standard", large: "Large", extra_large: "Extra large" };

const SWITCHES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "simplified_mode", label: "Simplified mode", hint: "Homie keeps guidance to the essential steps only." },
  { key: "voice_guidance", label: "Prefer voice guidance", hint: "Answers formatted for listening & screen readers." },
  { key: "high_contrast", label: "High contrast", hint: "Stronger colors and borders where supported." },
  { key: "reduce_motion", label: "Reduce motion", hint: "Minimize animations where supported." },
];

export default function AccessibilitySettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, m] = await Promise.all([api<Settings>("/hi/access/settings"), api<Meta>("/hi/access/meta")]);
      setS(st); setMeta(m);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = async (patch: Partial<Settings>) => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev));
    try { const next = await api<Settings>("/hi/access/settings", { method: "PUT", body: patch }); setS(next); } catch { load(); }
  };

  if (!s || !meta) return <View style={styles.root}><ScreenHeader title="Accessibility & Language" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Accessibility & Language" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.infoCard}>
          <MaterialCommunityIcons name="human-greeting-variant" size={20} color={colors.brandPrimary} />
          <Text style={styles.infoText}>Homie adapts its answers, project plans and guides to these settings.</Text>
        </View>

        <Text style={styles.section}>Language</Text>
        <View style={styles.chips}>
          {meta.languages.map((l) => {
            const on = s.language === l.code;
            return (
              <Pressable key={l.code} testID={`access-lang-${l.code}`} style={[styles.chip, on && styles.chipOn]} onPress={() => update({ language: l.code })}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>Reading level</Text>
        <Text style={styles.hint}>{RL_HINT[s.reading_level]}</Text>
        <View style={styles.chips}>
          {meta.reading_levels.map((rl) => {
            const on = s.reading_level === rl;
            return (
              <Pressable key={rl} testID={`access-rl-${rl}`} style={[styles.chip, on && styles.chipOn]} onPress={() => update({ reading_level: rl })}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{RL_LABEL[rl]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>Text size</Text>
        <View style={styles.chips}>
          {meta.text_sizes.map((ts) => {
            const on = s.text_size === ts;
            return (
              <Pressable key={ts} testID={`access-ts-${ts}`} style={[styles.chip, on && styles.chipOn]} onPress={() => update({ text_size: ts })}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{TS_LABEL[ts]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>Guidance</Text>
        {SWITCHES.map((sw) => (
          <View key={sw.key} style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>{sw.label}</Text>
              <Text style={styles.switchHint}>{sw.hint}</Text>
            </View>
            <Switch
              testID={`access-${sw.key}`}
              value={Boolean(s[sw.key])}
              onValueChange={(v) => update({ [sw.key]: v } as Partial<Settings>)}
              trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  infoCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary },
  section: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm },
  hint: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44, justifyContent: "center" },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary, fontFamily: font.bold },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  switchLabel: { fontFamily: font.medium, fontSize: type.lg, color: colors.onSurface },
  switchHint: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
