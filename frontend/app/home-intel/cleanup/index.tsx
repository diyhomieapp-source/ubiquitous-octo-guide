import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const RISK_COLOR: Record<string, string> = { low: colors.success, medium: colors.warning, high: colors.error, unknown: colors.onSurfaceTertiary };
const ACTION_LABEL: Record<string, string> = { keep: "Keep", reuse: "Reuse", donate: "Donate", recycle: "Recycle", dispose: "Dispose" };

export default function CleanupHub() {
  const router = useRouter();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const [session, setSession] = useState<any>(null);
  const [leftovers, setLeftovers] = useState<any[]>([]);
  const [waste, setWaste] = useState<any[]>([]);
  const [outcome, setOutcome] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<any>("/hi/cleanup/sessions", { method: "POST", body: { project_id } });
      const full = await api<any>(`/hi/cleanup/sessions/${s.id}`);
      setSession(full.session); setLeftovers(full.leftovers); setWaste(full.waste); setOutcome(full.outcome);
    } catch (e: any) { Alert.alert("Couldn't load", e?.message || "Try again."); }
    finally { setLoading(false); }
  }, [project_id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setLeftoverAction = async (lid: string, action: string) => {
    setBusy(true);
    try { await api(`/hi/cleanup/leftovers/${lid}`, { method: "PUT", body: { user_selected_action: action } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const toInventory = async (lid: string) => {
    setBusy(true);
    try { await api(`/hi/cleanup/leftovers/${lid}/to-inventory`, { method: "POST" }); await load(); Alert.alert("Added", "Saved to your Toolbox."); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try { const o = await api<any>(`/hi/cleanup/sessions/${session.id}/complete`, { method: "POST" }); setOutcome(o); await load(); }
    catch (e: any) { Alert.alert("Couldn't finish", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !session) return <View style={styles.root}><ScreenHeader title="Cleanup" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const isDone = session.status === "completed";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Cleanup & Disposal" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.intro}>Wrap up your project: keep what is useful, and get safety-first guidance for the rest.</Text>

        {isDone && outcome && (
          <View style={styles.doneCard}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.doneText}>Cleanup complete — {outcome.materials_saved_count} kept, {outcome.materials_added_to_inventory_count} to Toolbox, {outcome.waste_items_handled_count} waste handled{outcome.unresolved_items_count ? `, ${outcome.unresolved_items_count} still open` : ""}.</Text>
          </View>
        )}

        {/* Leftover materials */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Leftover materials</Text>
          {!isDone && <Pressable testID="add-leftover" style={styles.addBtn} onPress={() => router.push(`/home-intel/cleanup/add-leftover?sid=${session.id}`)}><MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} /><Text style={styles.addText}>Add</Text></Pressable>}
        </View>
        {leftovers.length === 0 ? <Text style={styles.empty}>No leftovers logged. Add usable materials so you do not buy them again.</Text> :
          leftovers.map((l) => (
            <View key={l.id} testID={`leftover-${l.id}`} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{l.name}</Text>
                  <Text style={styles.cardMeta}>{[l.material_category, l.quantity ? `${l.quantity}${l.unit ? " " + l.unit : ""}` : null, l.condition].filter(Boolean).join(" · ")}</Text>
                </View>
                {l.status === "moved_to_inventory" && <View style={styles.invTag}><Text style={styles.invText}>IN TOOLBOX</Text></View>}
              </View>
              {!isDone && l.status !== "moved_to_inventory" && (
                <>
                  <View style={styles.actionRow}>
                    {(["keep", "reuse", "donate", "recycle", "dispose"] as const).map((a) => (
                      <Pressable key={a} disabled={busy} style={[styles.actChip, l.user_selected_action === a && styles.actChipOn, l.recommended_action === a && l.user_selected_action !== a && styles.actChipRec]} onPress={() => setLeftoverAction(l.id, a)}>
                        <Text style={[styles.actText, l.user_selected_action === a && { color: "#fff" }]}>{ACTION_LABEL[a]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {l.recommended_action && <Text style={styles.recNote}>Homie suggests: {ACTION_LABEL[l.recommended_action] || l.recommended_action}</Text>}
                  {(l.user_selected_action === "keep" || l.recommended_action === "keep") && (
                    <Pressable testID={`to-inv-${l.id}`} disabled={busy} style={styles.invBtn} onPress={() => toInventory(l.id)}>
                      <MaterialCommunityIcons name="toolbox-outline" size={16} color={colors.brandPrimary} /><Text style={styles.invBtnText}>Save to my Toolbox</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          ))}

        {/* Waste items */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Waste & disposal</Text>
          {!isDone && <Pressable testID="add-waste" style={styles.addBtn} onPress={() => router.push(`/home-intel/cleanup/add-waste?sid=${session.id}`)}><MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} /><Text style={styles.addText}>Add</Text></Pressable>}
        </View>
        {waste.length === 0 ? <Text style={styles.empty}>No waste logged. Add debris or hazardous items for disposal guidance.</Text> :
          waste.map((w) => (
            <Pressable key={w.id} testID={`waste-${w.id}`} style={styles.card} onPress={() => router.push(`/home-intel/cleanup/waste/${w.id}`)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{w.name}</Text>
                  <Text style={styles.cardMeta}>{w.waste_category}{w.estimated_quantity ? ` · ${w.estimated_quantity}${w.unit ? " " + w.unit : ""}` : ""}</Text>
                </View>
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: RISK_COLOR[w.risk_level] || colors.onSurfaceTertiary }]} />
                  <Text style={[styles.riskText, { color: RISK_COLOR[w.risk_level] || colors.onSurfaceTertiary }]}>{w.risk_level}</Text>
                  {w.guidance_status === "handled" && <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} style={{ marginLeft: 6 }} />}
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
                </View>
              </View>
            </Pressable>
          ))}

        {!isDone && (
          <Pressable testID="cleanup-complete" style={styles.primary} disabled={busy} onPress={complete}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Finish cleanup</Text>}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  doneCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success + "18", borderColor: colors.success + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  doneText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 19 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  addText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  actChip: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  actChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actChipRec: { borderColor: colors.brandPrimary },
  actText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  recNote: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
  invBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, alignSelf: "flex-start" },
  invBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  invTag: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  invText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10 },
  riskRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  riskText: { fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
