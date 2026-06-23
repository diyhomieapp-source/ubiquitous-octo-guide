import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Task = { id: string; title: string; category: string; frequency: string; est_cost_cents: number; next_due: string; last_done?: string; notes?: string; source: string; status: string };
type Summary = { total: number; overdue: number; due_this_month: number; annual_budget_cents: number; spent_ytd_cents: number; on_track: boolean };

const FREQS = [
  { label: "Monthly", value: "monthly" }, { label: "Quarterly", value: "quarterly" },
  { label: "Twice a year", value: "biannual" }, { label: "Seasonal", value: "seasonal" },
  { label: "Yearly", value: "annual" }, { label: "One-time", value: "once" },
];
const FREQ_LABEL: Record<string, string> = Object.fromEntries(FREQS.map((f) => [f.value, f.label]));
const STATUS_META: Record<string, { label: string; color: string }> = {
  overdue: { label: "OVERDUE", color: "#EB5757" },
  due_soon: { label: "DUE SOON", color: "#FF8A50" },
  upcoming: { label: "UPCOMING", color: "#5B8DEF" },
};
const usd = (c?: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const fmtDue = (iso?: string) => {
  if (!iso) return "—";
  try { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return iso; }
};

const EMPTY = { title: "", category: "Other", frequency: "annual", est_cost: "", next_due: "" };

export default function Maintenance() {
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api<Task[]>("/maintenance/tasks"), api<Summary>("/maintenance/summary")]);
      setTasks(t); setSummary(s);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    setGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api("/maintenance/generate", { method: "POST" }); await load(); } finally { setGenerating(false); }
  };

  const complete = async (t: Task) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTasks((p) => p.filter((x) => x.id !== t.id));
    try { await api(`/maintenance/tasks/${t.id}/complete`, { method: "POST" }); } catch {}
    load();
  };

  const save = async () => {
    if (!editing?.title?.trim()) return;
    setBusy(true);
    const body = {
      title: editing.title.trim(), category: editing.category || "Other", frequency: editing.frequency,
      est_cost_cents: editing.est_cost ? Math.round(parseFloat(editing.est_cost) * 100) : 0,
      next_due: editing.next_due || undefined, notes: editing.notes || "",
    };
    try {
      if (editing.id) await api(`/maintenance/tasks/${editing.id}`, { method: "PUT", body });
      else await api("/maintenance/tasks", { method: "POST", body });
      setEditing(null); await load();
    } finally { setBusy(false); }
  };
  const remove = async () => { if (editing?.id) { await api(`/maintenance/tasks/${editing.id}`, { method: "DELETE" }); setEditing(null); await load(); } };

  const groups = [
    { key: "overdue", title: "OVERDUE", items: tasks.filter((t) => t.status === "overdue") },
    { key: "due_soon", title: "DUE THIS MONTH", items: tasks.filter((t) => t.status === "due_soon") },
    { key: "upcoming", title: "UPCOMING", items: tasks.filter((t) => t.status === "upcoming") },
  ];
  const budgetPct = summary && summary.annual_budget_cents > 0 ? Math.min(100, (summary.spent_ytd_cents / summary.annual_budget_cents) * 100) : 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Maintenance" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
        >
          {/* summary */}
          {summary && summary.total > 0 && (
            <>
              <View style={[styles.statusCard, { borderColor: summary.on_track ? colors.success : "#EB5757" }]}>
                <MaterialCommunityIcons name={summary.on_track ? "shield-check" : "alert-circle"} size={26} color={summary.on_track ? colors.success : "#EB5757"} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>{summary.on_track ? "You're on track!" : `${summary.overdue} task${summary.overdue === 1 ? "" : "s"} overdue`}</Text>
                  <Text style={styles.statusSub}>{summary.due_this_month} due this month · {summary.total} scheduled</Text>
                </View>
              </View>

              <View style={styles.budgetCard}>
                <View style={styles.budgetTop}>
                  <Text style={styles.budgetLabel}>ANNUAL MAINTENANCE BUDGET</Text>
                  <Text style={styles.budgetVal}>{usd(summary.annual_budget_cents)}/yr</Text>
                </View>
                <View style={styles.barTrack}><View style={[styles.barFill, { width: `${budgetPct}%` }]} /></View>
                <Text style={styles.budgetSpent}>{usd(summary.spent_ytd_cents)} spent this year</Text>
              </View>
            </>
          )}

          {/* empty / generate */}
          {tasks.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="calendar-check-outline" size={48} color={colors.brandPrimary} />
              <Text style={styles.emptyTitle}>Build your home maintenance plan</Text>
              <Text style={styles.emptySub}>Get a personalized, recurring schedule of seasonal tasks — so nothing slips and you stay on budget.</Text>
              <Pressable testID="generate-plan" style={styles.genBtn} onPress={generate} disabled={generating}>
                {generating ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <><MaterialCommunityIcons name="auto-fix" size={20} color={colors.onBrandPrimary} /><Text style={styles.genText}>GENERATE MY PLAN</Text></>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              {groups.map((g) => g.items.length === 0 ? null : (
                <View key={g.key} style={{ marginTop: spacing.lg }}>
                  <Text style={[styles.groupLabel, { color: STATUS_META[g.key].color }]}>{g.title} · {g.items.length}</Text>
                  {g.items.map((t) => (
                    <View key={t.id} style={styles.taskRow}>
                      <Pressable testID={`complete-${t.id}`} style={styles.check} onPress={() => complete(t)} hitSlop={8}>
                        <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={26} color={STATUS_META[t.status].color} />
                      </Pressable>
                      <Pressable style={{ flex: 1 }} onPress={() => setEditing({ ...t, est_cost: t.est_cost_cents ? String(t.est_cost_cents / 100) : "" })}>
                        <Text style={styles.taskTitle}>{t.title}</Text>
                        <Text style={styles.taskMeta}>{t.category} · {FREQ_LABEL[t.frequency] || t.frequency} · {t.est_cost_cents ? usd(t.est_cost_cents) : "DIY"}</Text>
                      </Pressable>
                      <View style={styles.taskRight}>
                        <Text style={[styles.taskDue, { color: STATUS_META[t.status].color }]}>{fmtDue(t.next_due)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* add FAB */}
      {!loading && tasks.length > 0 && (
        <Pressable testID="add-task" style={[styles.fab, { bottom: insets.bottom + spacing.lg }]} onPress={() => setEditing({ ...EMPTY })}>
          <MaterialCommunityIcons name="plus" size={26} color={colors.onBrandPrimary} />
        </Pressable>
      )}

      {/* edit / add modal */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditing(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing?.id ? "Edit Task" : "New Task"}</Text>
              <Text style={styles.fieldLabel}>TITLE</Text>
              <TextInput testID="task-title" style={styles.input} value={editing?.title ?? ""} onChangeText={(t) => setEditing((p: any) => ({ ...p, title: t }))} placeholder="e.g. Clean dryer vent" placeholderTextColor={colors.onSurfaceTertiary} />
              <Text style={styles.fieldLabel}>CATEGORY</Text>
              <TextInput testID="task-category" style={styles.input} value={editing?.category ?? ""} onChangeText={(t) => setEditing((p: any) => ({ ...p, category: t }))} placeholder="HVAC, Plumbing, Safety…" placeholderTextColor={colors.onSurfaceTertiary} />
              <Text style={styles.fieldLabel}>FREQUENCY</Text>
              <View style={styles.freqWrap}>
                {FREQS.map((f) => (
                  <Pressable key={f.value} testID={`freq-${f.value}`} onPress={() => setEditing((p: any) => ({ ...p, frequency: f.value }))} style={[styles.freqChip, editing?.frequency === f.value && styles.freqChipOn]}>
                    <Text style={[styles.freqText, editing?.frequency === f.value && { color: colors.onBrandPrimary }]}>{f.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>EST. COST ($)</Text>
                  <TextInput testID="task-cost" style={styles.input} value={editing?.est_cost ?? ""} onChangeText={(t) => setEditing((p: any) => ({ ...p, est_cost: t }))} placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>NEXT DUE</Text>
                  <TextInput testID="task-due" style={styles.input} value={editing?.next_due ?? ""} onChangeText={(t) => setEditing((p: any) => ({ ...p, next_due: t }))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
              </View>
              <Pressable testID="task-save" style={styles.saveBtn} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{editing?.id ? "SAVE" : "ADD TASK"}</Text>}
              </Pressable>
              {editing?.id && (
                <Pressable testID="task-delete" style={styles.delBtn} onPress={remove}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
                  <Text style={styles.delText}>Delete task</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  statusTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  statusSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  budgetCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg },
  budgetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  budgetLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  budgetVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  budgetSpent: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
  empty: { alignItems: "center", marginTop: spacing["2xl"], paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, textAlign: "center", marginTop: spacing.md },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 20, marginTop: spacing.sm },
  genBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, borderRadius: radius.md, marginTop: spacing.xl },
  genText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  groupLabel: { fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  check: { padding: 2 },
  taskTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  taskMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  taskRight: { alignItems: "flex-end" },
  taskDue: { fontFamily: font.bold, fontSize: type.base },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "90%" },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginBottom: 4, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, outlineStyle: "none" } as any,
  freqWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  freqChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  freqChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  freqText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center", marginTop: spacing.lg },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  delText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
});
