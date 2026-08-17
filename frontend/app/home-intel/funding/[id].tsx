import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState } from "@/src/components/ui";

const CLASS_COLOR: Record<string, string> = { confirmed: "#00E676", pending: "#29B6F6", expected: "#FFC400", potential: "#A0A0A5" };

export default function FundProject() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [savingAmt, setSavingAmt] = useState("");
  const [options, setOptions] = useState<any[]>([]);
  const [scanned, setScanned] = useState(false);
  const [mode, setMode] = useState<"plan" | "reduce">("plan");

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await api<any>(`/hi/funding/goals/${id}`); setPlan(res.plan); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveGoal = async () => {
    if (!target.trim()) { Alert.alert("Set a target", "How much do you want to cover?"); return; }
    setBusy(true);
    try { const res = await api<any>("/hi/funding/goals", { method: "POST", body: { project_id: id, target_amount: Number(target), current_budget: Number(budget || 0) } }); setPlan(res.plan); setTarget(""); setBudget(""); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const addSaving = async (classification: string) => {
    if (!savingAmt.trim()) { Alert.alert("Enter an amount", "How much did you save?"); return; }
    setBusy(true);
    try { const res = await api<any>("/hi/funding/savings", { method: "POST", body: { project_id: id, amount: Number(savingAmt), classification } }); setPlan(res.plan); setSavingAmt(""); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const scan = async () => {
    setBusy(true);
    try { const res = await api<any>(`/hi/funding/cost-reduction/${id}`); setOptions(res.options || []); setScanned(true); if (!res.options?.length) Alert.alert("No savings yet", res.message || "Check again later."); }
    catch (e: any) { Alert.alert("Scan failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const applyOption = async (o: any) => {
    setBusy(true);
    try { const res = await api<any>("/hi/funding/cost-reduction/apply", { method: "POST", body: { project_id: id, kind: o.kind, label: o.label, saving_estimate: o.saving_estimate, classification: o.classification, requirement_id: o.requirement_id } }); setPlan(res.plan); setOptions((prev) => prev.filter((x) => x.id !== o.id)); }
    catch (e: any) { Alert.alert("Couldn't apply", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !plan) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="fund-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Fund This Project</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <Text style={styles.tagline}>We lower project costs first, then find legitimate savings on purchases you already plan to make.</Text>

        {!plan.has_goal ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Set a funding target</Text>
            <TextInput testID="fund-target" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="How much do you want to cover? ($)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <TextInput testID="fund-budget" value={budget} onChangeText={setBudget} keyboardType="numeric" placeholder="Money you already have ($, optional)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Button testID="fund-save-goal" label="Start funding plan" icon="target" loading={busy} onPress={saveGoal} />
          </View>
        ) : (
          <>
            <View style={styles.planCard}>
              <View style={styles.planTop}>
                <Text style={styles.goalAmt}>${plan.target.toFixed(0)}</Text>
                <Text style={styles.goalLabel}>goal{plan.needed_by ? ` · by ${plan.needed_by}` : ""}</Text>
              </View>
              <Row label="In hand (budget)" value={plan.budget} color={colors.onSurface} />
              <Row label="Confirmed" value={plan.confirmed} color={CLASS_COLOR.confirmed} />
              <Row label="Pending" value={plan.pending} color={CLASS_COLOR.pending} />
              <Row label="Expected" value={plan.expected} color={CLASS_COLOR.expected} />
              <Row label="Potential (info only)" value={plan.potential} color={CLASS_COLOR.potential} />
              <View style={styles.divider} />
              <Row label="Remaining confirmed gap" value={plan.remaining_confirmed_gap} color={colors.onSurface} bold />
              <Row label="Remaining likely gap" value={plan.remaining_likely_gap} color={colors.onSurfaceTertiary} />
              {plan.goal_reached ? <Text style={styles.reached}>🎉 You've funded this project!</Text> : null}
            </View>

            <View style={styles.tabs}>
              <Pressable testID="fund-tab-reduce" style={[styles.tab, mode === "reduce" && styles.tabOn]} onPress={() => setMode("reduce")}><Text style={[styles.tabText, mode === "reduce" && styles.tabTextOn]}>Lower project cost</Text></Pressable>
              <Pressable testID="fund-tab-plan" style={[styles.tab, mode === "plan" && styles.tabOn]} onPress={() => setMode("plan")}><Text style={[styles.tabText, mode === "plan" && styles.tabTextOn]}>Log savings</Text></Pressable>
            </View>

            {mode === "reduce" ? (
              <View style={styles.card}>
                <Button testID="fund-scan" label="Scan for savings" icon="magnify-scan" variant="secondary" loading={busy} onPress={scan} />
                {scanned && options.length === 0 ? <Text style={styles.muted}>No verified savings opportunities right now.</Text> : null}
                {options.map((o) => (
                  <View key={o.id} style={styles.optRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optLabel}>{o.label}</Text>
                      <Text style={styles.optDetail}>{o.detail}</Text>
                      <Text style={[styles.optSave, { color: CLASS_COLOR[o.classification] }]}>~${o.saving_estimate.toFixed(2)} · {o.classification}</Text>
                    </View>
                    <Pressable testID={`fund-apply-${o.id}`} disabled={busy} style={styles.applyBtn} onPress={() => applyOption(o)}><Text style={styles.applyText}>Apply</Text></Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Log a saving</Text>
                <TextInput testID="fund-saving-amt" value={savingAmt} onChangeText={setSavingAmt} keyboardType="numeric" placeholder="Amount ($)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                <Text style={styles.muted}>Only confirmed savings (backed by a receipt) count toward your confirmed total.</Text>
                <View style={styles.classRow}>
                  <Button testID="fund-add-confirmed" label="Confirmed" onPress={() => addSaving("confirmed")} loading={busy} style={{ flex: 1 }} />
                  <Button testID="fund-add-expected" label="Expected" variant="secondary" onPress={() => addSaving("expected")} loading={busy} style={{ flex: 1 }} />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Row({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && { fontFamily: font.bold, color: colors.onSurface }]}>{label}</Text>
      <Text style={[styles.rowVal, { color }, bold && { fontFamily: font.bold }]}>${value.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  tagline: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  planCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  planTop: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginBottom: spacing.sm },
  goalAmt: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 34 },
  goalLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  rowVal: { fontFamily: font.medium, fontSize: type.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  reached: { color: colors.success, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm, textAlign: "center" },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary },
  muted: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  optLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  optDetail: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
  optSave: { fontFamily: font.bold, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  applyBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8 },
  applyText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  classRow: { flexDirection: "row", gap: spacing.sm },
});
