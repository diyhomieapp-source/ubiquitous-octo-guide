import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_META: Record<string, { label: string; color: string }> = {
  on_track: { label: "On track", color: colors.success },
  at_risk: { label: "Estimate above target", color: colors.warning },
  over_budget: { label: "Over budget", color: colors.error },
  no_target: { label: "No budget target set", color: colors.onSurfaceTertiary },
};
const CATEGORIES = ["materials", "tools", "tool_rental", "delivery", "permits", "professional_services", "disposal", "contingency", "other"];
const CONF_COLOR: Record<string, string> = { high: colors.success, medium: colors.warning, low: colors.error };

export default function BudgetWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // add expense
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("materials");
  const [busy, setBusy] = useState(false);
  // target
  const [targetOpen, setTargetOpen] = useState(false);
  const [target, setTarget] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api(`/hi/pi/projects/${id}/budget-workspace`));
      const e = await api<{ expenses: any[] }>(`/hi/pi/projects/${id}/expenses`);
      setExpenses(e.expenses);
      const c = await api<{ changes: any[] }>(`/hi/pi/projects/${id}/changes`);
      setChanges(c.changes);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addExpense = async () => {
    if (!label.trim() || !amount.trim()) { Alert.alert("Almost there", "A label and amount are needed."); return; }
    setBusy(true);
    try {
      await api(`/hi/pi/projects/${id}/expenses`, { method: "POST", body: { label: label.trim(), amount: parseFloat(amount), category } });
      setAdding(false); setLabel(""); setAmount("");
      load();
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const saveTarget = async () => {
    setBusy(true);
    try {
      await api(`/hi/pi/projects/${id}/budget`, { method: "PUT", body: { budget_limit: parseFloat(target) || 0 } });
      setTargetOpen(false); setTarget("");
      load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const decideChange = async (eid: string, action: "apply" | "reject") => {
    try { await api(`/hi/pi/change-events/${eid}/${action}`, { method: "POST", body: {} }); load(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.detail || e?.message || "Try again."); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Budget" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const st = STATUS_META[data.status] || STATUS_META.no_target;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Budget & Changes" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.summary}>
          <Text style={styles.projTitle}>{data.project.title}</Text>
          <View style={styles.line}><Text style={styles.lineLabel}>Estimated total</Text><Text style={styles.lineValue}>${data.estimated_total}</Text></View>
          <View style={styles.line}><Text style={styles.lineLabel}>Purchased so far</Text><Text testID="budget-purchased" style={styles.lineValue}>${data.purchased_total}</Text></View>
          <View style={styles.line}><Text style={styles.lineLabel}>Remaining estimate</Text><Text style={styles.lineValue}>${data.remaining_estimate}</Text></View>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>Budget target</Text>
            <Pressable testID="budget-target-edit" onPress={() => { setTarget(data.budget_target ? String(data.budget_target) : ""); setTargetOpen(true); }}>
              <Text style={[styles.lineValue, { color: colors.brandPrimary }]}>{data.budget_target != null ? `$${data.budget_target}` : "Set target"}</Text>
            </Pressable>
          </View>
          <Text testID="budget-status" style={[styles.status, { color: st.color }]}>{st.label}</Text>
          <View style={styles.confRow}>
            <View style={[styles.confDot, { backgroundColor: CONF_COLOR[data.confidence] }]} />
            <Text style={styles.confText}>Confidence: {data.confidence} — {data.confidence_reason}</Text>
          </View>
        </View>

        <Pressable testID="budget-add-expense" style={styles.addBtn} onPress={() => setAdding(true)}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add Expense</Text>
        </Pressable>

        {expenses.length > 0 && <Text style={styles.section}>Expenses</Text>}
        {expenses.map((e) => (
          <View key={e.id} style={styles.expRow}>
            <Text style={styles.expLabel}>{e.label}</Text>
            <Text style={styles.expCat}>{String(e.category).replace(/_/g, " ")}</Text>
            <Text style={styles.expAmt}>${e.amount}</Text>
          </View>
        ))}

        <Text style={styles.section}>What changed?</Text>
        {changes.length === 0 && <Text style={styles.empty}>No project changes recorded — the plan is holding steady.</Text>}
        {changes.map((c) => (
          <View key={c.id} style={styles.changeCard}>
            <Text style={styles.changeType}>{String(c.change_type).replace(/_/g, " ")} · {c.status}</Text>
            {!!c.impact_summary && <Text style={styles.changeImpact}>{c.impact_summary}</Text>}
            {!!c.new_value && <Text style={styles.changeVal}>New: {c.new_value}{c.old_value ? ` (was ${c.old_value})` : ""}</Text>}
            {c.status === "pending_review" && (
              <View style={styles.rowBtns}>
                <Pressable testID={`change-apply-${c.id}`} style={styles.applyBtn} onPress={() => decideChange(c.id, "apply")}><Text style={styles.applyText}>Approve</Text></Pressable>
                <Pressable testID={`change-reject-${c.id}`} style={styles.rejectBtn} onPress={() => decideChange(c.id, "reject")}><Text style={styles.rejectText}>Reject</Text></Pressable>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add expense</Text>
            <TextInput testID="exp-label" style={styles.input} placeholder="What was it? (e.g. Delivery fee)" placeholderTextColor={colors.onSurfaceTertiary} value={label} onChangeText={setLabel} />
            <TextInput testID="exp-amount" style={styles.input} placeholder="Amount ($)" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <View style={styles.catRow}>
                {CATEGORIES.map((c) => (
                  <Pressable key={c} style={[styles.catChip, category === c && styles.catActive]} onPress={() => setCategory(c)}>
                    <Text style={[styles.catText, category === c && { color: colors.brandPrimary }]}>{c.replace(/_/g, " ")}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <View style={styles.rowBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setAdding(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="exp-save" style={styles.saveBtn} disabled={busy} onPress={addExpense}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={targetOpen} transparent animationType="slide" onRequestClose={() => setTargetOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Budget target</Text>
            <TextInput testID="budget-target-input" style={styles.input} placeholder="Target amount ($)" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
            <View style={styles.rowBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setTargetOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="budget-target-save" style={styles.saveBtn} disabled={busy} onPress={saveTarget}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  summary: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  projTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.xs },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  lineLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  lineValue: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  status: { fontFamily: font.bold, fontSize: type.base, marginTop: spacing.xs },
  confRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  confText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, flex: 1 },
  addBtn: { flexDirection: "row", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  addText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  expRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  expLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, flex: 1 },
  expCat: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  expAmt: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  changeCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  changeType: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textTransform: "capitalize" },
  changeImpact: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  changeVal: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  rowBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  applyBtn: { flex: 1, alignItems: "center", backgroundColor: colors.success + "22", borderColor: colors.success, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm },
  applyText: { color: colors.success, fontFamily: font.bold, fontSize: type.sm },
  rejectBtn: { flex: 1, alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm },
  rejectText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  modalWrap: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.sm },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  catRow: { flexDirection: "row", gap: spacing.xs },
  catChip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
  catActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  catText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  cancelBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  saveBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
