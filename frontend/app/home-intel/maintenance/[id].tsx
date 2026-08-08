import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Task = {
  id: string; title: string; category: string; priority: string; due_date: string; status: string;
  computed_status: string; frequency_type: string; description?: string | null; notes?: string | null;
  source: string; source_reason?: string | null; asset_name?: string | null; room_name?: string | null; season?: string | null;
};
type Occ = { id: string; scheduled_date: string; completed_date?: string | null; status: string; cost?: string | null; notes?: string | null };
type Detail = { task: Task; checklist: any[]; occurrences: Occ[] };

const STATUS_COLOR: Record<string, string> = { overdue: colors.error, due: colors.warning, upcoming: colors.info, completed: colors.success, skipped: colors.onSurfaceTertiary, paused: colors.onSurfaceTertiary };
const FREQ_LABEL: Record<string, string> = { one_time: "One time", monthly: "Monthly", quarterly: "Every 3 months", biannual: "Every 6 months", annual: "Yearly", custom: "Custom" };

export default function MaintenanceDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showComplete, setShowComplete] = useState(false);
  const [showResched, setShowResched] = useState(false);
  const [notes, setNotes] = useState(""); const [cost, setCost] = useState("");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api<Detail>(`/hi/maintenance/tasks/${id}`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const complete = async () => {
    setBusy(true);
    try {
      const res = await api<{ recurring: boolean; next_due?: string }>(`/hi/maintenance/tasks/${id}/complete`, {
        method: "POST", body: { notes: notes.trim() || undefined, cost: cost.trim() || undefined },
      });
      setShowComplete(false); setNotes(""); setCost("");
      Alert.alert("Done ✅", res.recurring ? `Next time scheduled for ${res.next_due}.` : "Task completed.");
      load();
    } catch (e: any) { Alert.alert("Couldn't complete", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const skip = () => {
    Alert.alert("Skip this time?", "It will roll forward to the next scheduled date if recurring.", [
      { text: "Cancel", style: "cancel" },
      { text: "Skip", onPress: async () => { try { await api(`/hi/maintenance/tasks/${id}/skip`, { method: "POST" }); load(); } catch {} } },
    ]);
  };

  const reschedule = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { Alert.alert("Check the date", "Use format YYYY-MM-DD."); return; }
    setBusy(true);
    try { await api(`/hi/maintenance/tasks/${id}/reschedule`, { method: "POST", body: { due_date: newDate } }); setShowResched(false); setNewDate(""); load(); }
    catch (e: any) { Alert.alert("Couldn't reschedule", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const togglePause = async () => {
    const paused = d?.task.status === "paused";
    try { await api(`/hi/maintenance/tasks/${id}/pause?resume=${paused}`, { method: "PUT" }); load(); } catch {}
  };

  const archive = () => {
    Alert.alert("Delete task?", "This removes it from your plan (history is kept).", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/hi/maintenance/tasks/${id}`, { method: "DELETE" }); router.back(); } catch {} } },
    ]);
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Task" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  if (!d) return <View style={styles.root}><ScreenHeader title="Task" /><Text style={styles.empty}>Task not found.</Text></View>;

  const t = d.task;
  const cs = t.computed_status;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Maintenance Task" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.header}>
          <View style={[styles.statusChip, { backgroundColor: (STATUS_COLOR[cs] || colors.info) + "22", borderColor: STATUS_COLOR[cs] || colors.info }]}>
            <Text style={[styles.statusText, { color: STATUS_COLOR[cs] || colors.info }]}>{cs}</Text>
          </View>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.meta}>{t.category} · {FREQ_LABEL[t.frequency_type] || t.frequency_type} · due {t.due_date}</Text>
          {(t.asset_name || t.room_name) && <Text style={styles.meta}>{t.asset_name ? `Asset: ${t.asset_name}` : ""}{t.room_name ? `${t.asset_name ? "  ·  " : ""}Room: ${t.room_name}` : ""}</Text>}
        </View>

        {t.source === "ai_suggested" && t.source_reason && (
          <View style={styles.aiBox}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.aiText}>{t.source_reason}</Text>
          </View>
        )}
        {t.notes && <Text style={styles.notes}>{t.notes}</Text>}

        {t.status !== "completed" && (
          <>
            <Pressable testID="maint-complete-btn" style={styles.primary} onPress={() => setShowComplete(true)}>
              <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.primaryText}>Mark complete</Text>
            </Pressable>
            <View style={styles.row}>
              <Pressable testID="maint-skip-btn" style={styles.secondary} onPress={skip}>
                <Text style={styles.secondaryText}>Skip</Text>
              </Pressable>
              <Pressable testID="maint-reschedule-btn" style={styles.secondary} onPress={() => { setNewDate(t.due_date); setShowResched(true); }}>
                <Text style={styles.secondaryText}>Reschedule</Text>
              </Pressable>
              <Pressable testID="maint-pause-btn" style={styles.secondary} onPress={togglePause}>
                <Text style={styles.secondaryText}>{t.status === "paused" ? "Resume" : "Pause"}</Text>
              </Pressable>
            </View>
          </>
        )}

        <Text style={styles.section}>History</Text>
        {d.occurrences.length === 0 ? <Text style={styles.empty}>No history yet.</Text> :
          d.occurrences.map((o) => (
            <View key={o.id} style={styles.occRow}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[o.status] || colors.info }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.occText}>{o.status === "completed" ? `Completed ${o.completed_date}` : o.status === "skipped" ? `Skipped ${o.completed_date}` : `Scheduled ${o.scheduled_date}`}</Text>
                {(o.cost || o.notes) && <Text style={styles.occMeta}>{o.cost ? `$${o.cost}` : ""}{o.cost && o.notes ? " · " : ""}{o.notes || ""}</Text>}
              </View>
            </View>
          ))}

        <Pressable testID="maint-archive-btn" style={styles.archive} onPress={archive}>
          <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
          <Text style={styles.archiveText}>Delete task</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showComplete} transparent animationType="slide" onRequestClose={() => setShowComplete(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Complete task</Text>
            <Text style={styles.label}>What did it cost? (optional)</Text>
            <TextInput testID="maint-complete-cost" style={styles.input} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.onSurfaceTertiary} />
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput testID="maint-complete-notes" style={[styles.input, { minHeight: 70 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" placeholder="e.g. used MERV 11 filter" placeholderTextColor={colors.onSurfaceTertiary} />
            <Pressable testID="maint-complete-save" style={[styles.primary, { marginTop: spacing.md }, busy && { opacity: 0.6 }]} disabled={busy} onPress={complete}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Confirm complete</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={() => setShowComplete(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showResched} transparent animationType="slide" onRequestClose={() => setShowResched(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Reschedule</Text>
            <Text style={styles.label}>New due date (YYYY-MM-DD)</Text>
            <TextInput testID="maint-resched-date" style={styles.input} value={newDate} onChangeText={setNewDate} autoCapitalize="none" placeholder="2026-08-01" placeholderTextColor={colors.onSurfaceTertiary} />
            <Pressable testID="maint-resched-save" style={[styles.primary, { marginTop: spacing.md }, busy && { opacity: 0.6 }]} disabled={busy} onPress={reschedule}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save date</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={() => setShowResched(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { marginBottom: spacing.md },
  statusChip: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, marginBottom: spacing.sm },
  statusText: { fontFamily: font.bold, fontSize: 11, textTransform: "uppercase" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4 },
  aiBox: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  aiText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 19 },
  notes: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.md },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  secondary: { flex: 1, alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  occRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  occText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  occMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  archive: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.xl },
  archiveText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#000000AA" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"] },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  cancel: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
