import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const RISK_COLOR: Record<string, string> = { low: colors.success, medium: colors.warning, high: colors.error, unknown: colors.onSurfaceTertiary };
const ACTIONS = ["recycle", "donate", "drop-off", "trash", "hazardous drop-off"];

export default function WasteGuidance() {
  const router = useRouter();
  const { wid } = useLocalSearchParams<{ wid: string }>();
  const [waste, setWaste] = useState<any>(null);
  const [guidance, setGuidance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ waste: any; guidance: any }>(`/hi/cleanup/waste/${wid}/guidance`); setWaste(d.waste); setGuidance(d.guidance); }
    catch (e: any) { Alert.alert("Couldn't load", e?.message || "Try again."); }
    finally { setLoading(false); }
  }, [wid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pick = async (action: string) => {
    setBusy(true);
    try { const w = await api<any>(`/hi/cleanup/waste/${wid}`, { method: "PUT", body: { user_selected_action: action } }); setWaste(w); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const markHandled = async () => {
    setBusy(true);
    try { const w = await api<any>(`/hi/cleanup/waste/${wid}`, { method: "PUT", body: { guidance_status: "handled" } }); setWaste(w); router.back(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !waste) return <View style={styles.root}><ScreenHeader title="Disposal" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const risk = waste.risk_level || "unknown";
  const rc = RISK_COLOR[risk] || colors.onSurfaceTertiary;
  const handled = waste.guidance_status === "handled";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Disposal guidance" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.title}>{waste.name}</Text>
        <View style={styles.metaRow}>
          <View style={styles.tag}><Text style={styles.tagText}>{waste.waste_category}</Text></View>
          <View style={[styles.tag, { borderColor: rc }]}><View style={[styles.dot, { backgroundColor: rc }]} /><Text style={[styles.tagText, { color: rc }]}>{risk} risk</Text></View>
          {handled && <View style={[styles.tag, { borderColor: colors.success }]}><MaterialCommunityIcons name="check" size={13} color={colors.success} /><Text style={[styles.tagText, { color: colors.success }]}> Handled</Text></View>}
        </View>

        {guidance?.safety_note && (
          <View style={[styles.safetyCard, { borderColor: rc, backgroundColor: rc + "18" }]}>
            <MaterialCommunityIcons name="alert-outline" size={20} color={rc} />
            <Text style={[styles.safetyText, { color: colors.onSurface }]}>{guidance.safety_note}</Text>
          </View>
        )}

        {guidance?.guidance_text && (
          <>
            <Text style={styles.section}>What to do</Text>
            <Text style={styles.body}>{guidance.guidance_text}</Text>
          </>
        )}

        {guidance?.local_verification_required && (
          <View style={styles.verifyCard}>
            <MaterialCommunityIcons name="map-marker-radius-outline" size={18} color={colors.info} />
            <Text style={styles.verifyText}>This is general guidance only. Rules vary by area — verify with your local waste or recycling program before disposing.</Text>
          </View>
        )}

        {!handled && (
          <>
            <Text style={styles.section}>How will you handle it?</Text>
            <View style={styles.wrap}>
              {ACTIONS.map((a) => (
                <Pressable key={a} disabled={busy} style={[styles.chip, waste.user_selected_action === a && styles.chipOn]} onPress={() => pick(a)}>
                  <Text style={[styles.chipText, waste.user_selected_action === a && { color: "#fff" }]}>{a}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable testID="w-handled" style={styles.primary} disabled={busy} onPress={markHandled}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Mark as handled</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  tagText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  safetyCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  safetyText: { flex: 1, fontFamily: font.bold, fontSize: type.base, lineHeight: 21 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22 },
  verifyCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  verifyText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
