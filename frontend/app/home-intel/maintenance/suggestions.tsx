import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Sug = { id: string; suggested_title: string; reason: string; recommended_frequency: string; confidence_level: string };
const FREQ_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Every 3 mo", biannual: "Every 6 mo", annual: "Yearly" };

export default function MaintenanceSuggestions() {
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const d = await api<{ suggestions: Sug[] }>("/hi/maintenance/suggestions"); setSugs(d.suggestions); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    setGenerating(true);
    try {
      const d = await api<{ generated: number; suggestions: Sug[] }>("/hi/maintenance/suggestions/generate", { method: "POST" });
      setSugs(d.suggestions);
      if (d.generated === 0 && d.suggestions.length === 0) Alert.alert("No new ideas", "Add your home assets first so Homie can tailor suggestions.");
    } catch (e: any) { Alert.alert("Couldn't generate", e?.message || "Try again."); }
    finally { setGenerating(false); }
  };

  const accept = async (id: string) => {
    setActing(id);
    try { await api(`/hi/maintenance/suggestions/${id}/accept`, { method: "POST" }); setSugs((s) => s.filter((x) => x.id !== id)); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
    finally { setActing(null); }
  };

  const dismiss = async (id: string) => {
    setActing(id);
    try { await api(`/hi/maintenance/suggestions/${id}/dismiss`, { method: "POST" }); setSugs((s) => s.filter((x) => x.id !== id)); }
    catch {} finally { setActing(null); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="AI Maintenance Ideas" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.intro}>Homie suggests recurring care based on your real assets and the season. Add the ones that fit — nothing is added automatically.</Text>

        <Pressable testID="sug-generate" style={[styles.gen, generating && { opacity: 0.6 }]} disabled={generating} onPress={generate}>
          {generating ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <><MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={colors.onBrandPrimary} /><Text style={styles.genText}>Generate suggestions</Text></>
          )}
        </Pressable>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          sugs.length === 0 ? <Text style={styles.empty}>No pending suggestions. Tap generate to get fresh ideas.</Text> :
          sugs.map((s) => (
            <View key={s.id} testID={`sug-${s.id}`} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.title}>{s.suggested_title}</Text>
                <View style={[styles.conf, { borderColor: s.confidence_level === "Likely" ? colors.success : colors.info }]}>
                  <Text style={[styles.confText, { color: s.confidence_level === "Likely" ? colors.success : colors.info }]}>{s.confidence_level}</Text>
                </View>
              </View>
              <Text style={styles.reason}>{s.reason}</Text>
              <Text style={styles.freq}>{FREQ_LABEL[s.recommended_frequency] || s.recommended_frequency}</Text>
              <View style={styles.actions}>
                <Pressable testID={`sug-accept-${s.id}`} style={[styles.accept, acting === s.id && { opacity: 0.6 }]} disabled={acting === s.id} onPress={() => accept(s.id)}>
                  <MaterialCommunityIcons name="plus" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.acceptText}>Add to plan</Text>
                </Pressable>
                <Pressable testID={`sug-dismiss-${s.id}`} style={styles.dismiss} disabled={acting === s.id} onPress={() => dismiss(s.id)}>
                  <Text style={styles.dismissText}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.md },
  gen: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  genText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  conf: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  confText: { fontFamily: font.bold, fontSize: 10 },
  reason: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, marginTop: spacing.xs },
  freq: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  accept: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm },
  acceptText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  dismiss: { paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm },
  dismissText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
