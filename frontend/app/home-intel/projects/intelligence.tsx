import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const PHASE_ICON: Record<string, string> = {
  blocked: "alert-octagon", safety: "shield-alert", acquire: "cart-outline",
  execute: "hammer-wrench", plan: "clipboard-list-outline", complete: "flag-checkered",
};
const CHANGE_OPTS = [
  { type: "budget", label: "Budget", values: ["Low", "Flexible"] },
  { type: "measurement", label: "Measurement", values: ["Updated"] },
  { type: "material", label: "Material", values: ["Substitute"] },
  { type: "scope", label: "Scope", values: ["Smaller", "Bigger"] },
];
const BLOCKER_TYPES = ["missing_measurement", "missing_material", "missing_tool", "weather", "safety", "budget", "other"];

export default function ProjectIntelligence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const [showBlocker, setShowBlocker] = useState(false);
  const [bType, setBType] = useState("missing_measurement"); const [bDesc, setBDesc] = useState("");
  const [showChange, setShowChange] = useState(false);
  const [changeType, setChangeType] = useState("budget"); const [changeVal, setChangeVal] = useState("Low");
  const [impact, setImpact] = useState<any>(null);
  const [limit, setLimit] = useState("");

  const load = useCallback(async () => {
    setErr(false);
    try { const d = await api<any>(`/hi/pi/projects/${id}/workspace`); setData(d); setLimit(d.budget.budget_limit != null ? String(d.budget.budget_limit) : ""); }
    catch { setErr(true); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addBlocker = async () => {
    if (!bDesc.trim()) { Alert.alert("Describe it", "What's blocking you?"); return; }
    setBusy(true);
    try { await api(`/hi/pi/projects/${id}/blockers`, { method: "POST", body: { blocker_type: bType, description: bDesc.trim() } }); setBDesc(""); setShowBlocker(false); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const resolveBlocker = async (bid: string) => {
    setBusy(true);
    try { await api(`/hi/pi/blockers/${bid}/resolve`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const previewChange = async () => {
    setBusy(true); setImpact(null);
    try { setImpact(await api<any>(`/hi/pi/projects/${id}/change`, { method: "POST", body: { change_type: changeType, new_value: changeVal } })); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const applyChange = async () => {
    if (!impact) return;
    setBusy(true);
    try { await api(`/hi/pi/change-events/${impact.id}/apply`, { method: "POST" }); setImpact(null); setShowChange(false); await load(); Alert.alert("Applied", "Your plan preferences were updated."); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const saveLimit = async () => {
    setBusy(true);
    try { const s = await api<any>(`/hi/pi/projects/${id}/budget`, { method: "PUT", body: { budget_limit: limit ? parseFloat(limit) : 0 } }); setData((d: any) => ({ ...d, budget: s })); Alert.alert("Saved", "Budget limit updated."); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !data) return (
    <View style={styles.root}>
      <ScreenHeader title="Project Intelligence" />
      {err ? (
        <View style={{ alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.md }}>
          <MaterialCommunityIcons name="wifi-off" size={36} color={colors.onSurfaceTertiary} />
          <Text style={{ color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base }}>Could not load this project.</Text>
          <Pressable testID="pi-retry" style={styles.primarySm} onPress={() => { setLoading(true); load(); }}><Text style={styles.primarySmText}>  Retry  </Text></Pressable>
        </View>
      ) : <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />}
    </View>
  );

  const nba = data.next_best_action;
  const b = data.budget;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Project Intelligence" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.projTitle}>{data.project.title}</Text>
        <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${data.progress.pct}%` }]} /></View>
        <Text style={styles.progressText}>{data.progress.done}/{data.progress.total} steps · {data.progress.pct}%</Text>

        {/* Next best step */}
        <View style={styles.nbaCard}>
          <View style={styles.nbaHead}>
            <MaterialCommunityIcons name={(PHASE_ICON[nba.phase] || "arrow-right-bold") as any} size={20} color={colors.onBrandPrimary} />
            <Text style={styles.nbaLabel}>Your next best step</Text>
          </View>
          <Text style={styles.nbaTitle}>{nba.title}</Text>
          <Text style={styles.nbaWhy}>{nba.why}</Text>
        </View>

        {/* Blockers */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Blockers ({data.blockers.length})</Text>
          <Pressable testID="pi-add-blocker" style={styles.addBtn} onPress={() => setShowBlocker((v) => !v)}><MaterialCommunityIcons name={showBlocker ? "close" : "plus"} size={16} color={colors.brandPrimary} /><Text style={styles.addText}>{showBlocker ? "Close" : "Add"}</Text></Pressable>
        </View>
        {showBlocker && (
          <View style={styles.form}>
            <View style={styles.wrap}>
              {BLOCKER_TYPES.map((t) => (
                <Pressable key={t} style={[styles.chip, bType === t && styles.chipOn]} onPress={() => setBType(t)}><Text style={[styles.chipText, bType === t && { color: "#fff" }]}>{t.replace(/_/g, " ")}</Text></Pressable>
              ))}
            </View>
            <TextInput testID="pi-blocker-desc" style={styles.input} value={bDesc} onChangeText={setBDesc} placeholder="What's blocking progress?" placeholderTextColor={colors.onSurfaceTertiary} />
            <Pressable testID="pi-blocker-save" style={styles.primarySm} disabled={busy} onPress={addBlocker}><Text style={styles.primarySmText}>Add blocker</Text></Pressable>
          </View>
        )}
        {data.blockers.length === 0 && !showBlocker ? <Text style={styles.empty}>No blockers. You are clear to keep going.</Text> :
          data.blockers.map((bl: any) => (
            <View key={bl.id} testID={`pi-blocker-${bl.id}`} style={styles.blockerRow}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.blockerDesc}>{bl.description}</Text>
                <Text style={styles.blockerType}>{bl.blocker_type.replace(/_/g, " ")}</Text>
              </View>
              <Pressable testID={`pi-resolve-${bl.id}`} disabled={busy} style={styles.smallBtn} onPress={() => resolveBlocker(bl.id)}><Text style={styles.smallBtnText}>Resolve</Text></Pressable>
            </View>
          ))}

        {/* Materials needed now */}
        {data.needed_now.length > 0 && (
          <>
            <Text style={styles.section}>Needed now</Text>
            {data.needed_now.map((m: any, i: number) => (
              <View key={i} style={styles.needRow}><MaterialCommunityIcons name="cart-outline" size={16} color={colors.brandPrimary} /><Text style={styles.needText}>{m.name}</Text></View>
            ))}
          </>
        )}

        {/* Budget */}
        <Text style={styles.section}>Budget</Text>
        <View style={styles.budgetCard}>
          <BudgetRow label="Estimated (required)" value={`$${b.estimated_required_cost}`} />
          <BudgetRow label="Estimated (optional)" value={`$${b.estimated_optional_cost}`} />
          <BudgetRow label="Actual spend" value={`$${b.actual_spend}`} />
          {b.budget_limit != null && <BudgetRow label="Limit" value={`$${b.budget_limit}`} accent={b.over_budget} />}
        </View>
        <View style={styles.row}>
          <TextInput testID="pi-limit" style={styles.input} value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="Set budget limit ($)" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="pi-limit-save" style={styles.saveBtn} disabled={busy} onPress={saveLimit}><Text style={styles.saveText}>Save</Text></Pressable>
        </View>

        {/* Change project details */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Change project details</Text>
          <Pressable testID="pi-change" style={styles.addBtn} onPress={() => { setShowChange((v) => !v); setImpact(null); }}><MaterialCommunityIcons name={showChange ? "close" : "pencil"} size={16} color={colors.brandPrimary} /><Text style={styles.addText}>{showChange ? "Close" : "Change"}</Text></Pressable>
        </View>
        {showChange && (
          <View style={styles.form}>
            <View style={styles.wrap}>
              {CHANGE_OPTS.map((c) => (
                <Pressable key={c.type} style={[styles.chip, changeType === c.type && styles.chipOn]} onPress={() => { setChangeType(c.type); setChangeVal(c.values[0]); setImpact(null); }}><Text style={[styles.chipText, changeType === c.type && { color: "#fff" }]}>{c.label}</Text></Pressable>
              ))}
            </View>
            <View style={styles.wrap}>
              {(CHANGE_OPTS.find((c) => c.type === changeType)?.values || []).map((v) => (
                <Pressable key={v} style={[styles.chip, changeVal === v && styles.chipOn]} onPress={() => { setChangeVal(v); setImpact(null); }}><Text style={[styles.chipText, changeVal === v && { color: "#fff" }]}>{v}</Text></Pressable>
              ))}
            </View>
            <Pressable testID="pi-preview" style={styles.primarySm} disabled={busy} onPress={previewChange}><Text style={styles.primarySmText}>Preview impact</Text></Pressable>
            {impact && (
              <View style={styles.impactCard}>
                <Text style={styles.impactSummary}>{impact.impact_summary}</Text>
                {impact.recommendations.map((r: string, i: number) => <Text key={i} style={styles.impactRec}>• {r}</Text>)}
                <Pressable testID="pi-apply" style={styles.primarySm} disabled={busy} onPress={applyChange}><Text style={styles.primarySmText}>Apply change</Text></Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function BudgetRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.bRow}><Text style={styles.bLabel}>{label}</Text><Text style={[styles.bVal, accent && { color: colors.error }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  projTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  progressBar: { height: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 4, marginTop: spacing.md, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.brandPrimary, borderRadius: 4 },
  progressText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  nbaCard: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg },
  nbaHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  nbaLabel: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.xs, textTransform: "uppercase", opacity: 0.9, letterSpacing: 0.5 },
  nbaTitle: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: type.xl, marginTop: spacing.sm },
  nbaWhy: { color: colors.onBrandPrimary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.xs, opacity: 0.92 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  addText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  primarySm: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  primarySmText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  blockerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  blockerDesc: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  blockerType: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
  needRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  needText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  budgetCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  bRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  bLabel: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  bVal: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  impactCard: { backgroundColor: colors.surface, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, gap: 4 },
  impactSummary: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, lineHeight: 20 },
  impactRec: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
});
