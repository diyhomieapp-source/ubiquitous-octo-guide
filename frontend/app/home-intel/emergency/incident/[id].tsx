import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUSES = ["active", "contained", "documenting", "repair_in_progress", "resolved"];

export default function IncidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inc, setInc] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [note, setNote] = useState<any>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<any>(`/hi/emergency/incidents/${id}`); setInc(r.incident); setTimeline(r.timeline || []); setNote(r.note); }
    catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (status: string) => {
    setBusy(true);
    try { await api(`/hi/emergency/incidents/${id}`, { method: "PUT", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try { await api(`/hi/emergency/incidents/${id}/timeline`, { method: "POST", body: { event_type: "note", note: noteText } }); setNoteText(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !inc) return <View style={styles.root}><ScreenHeader title="Incident" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title={String(inc.incident_type).replace(/_/g, " ")} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.meta}>Started {String(inc.occurred_at).slice(0, 16).replace("T", " ")}</Text>
        <Text style={styles.label}>Status</Text>
        <View style={styles.statusWrap}>
          {STATUSES.map((s) => <Pressable key={s} testID={`er-inc-status-${s}`} disabled={busy} style={[styles.chip, inc.status === s && styles.chipOn]} onPress={() => setStatus(s)}><Text style={[styles.chipText, inc.status === s && styles.chipTextOn]}>{s.replace(/_/g, " ")}</Text></Pressable>)}
        </View>

        <Text style={styles.label}>Timeline & damage notes</Text>
        {timeline.length === 0 ? <Text style={styles.empty}>No notes yet. Add photos and notes to document what happened.</Text> :
          timeline.map((e) => (
            <View key={e.id} style={styles.tlRow}>
              <View style={styles.dot} />
              <View style={styles.tlCard}><Text style={styles.tlNote}>{e.note || e.event_type}</Text><Text style={styles.tlDate}>{String(e.occurred_at).slice(0, 16).replace("T", " ")}</Text></View>
            </View>
          ))}
        <View style={styles.addRow}>
          <TextInput testID="er-inc-note" value={noteText} onChangeText={setNoteText} placeholder="Add a note (damage, action taken, estimate…)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
          <Pressable testID="er-inc-note-add" disabled={busy || !noteText.trim()} style={[styles.addBtn, (busy || !noteText.trim()) && { opacity: 0.5 }]} onPress={addNote}><MaterialCommunityIcons name="send" size={18} color="#fff" /></Pressable>
        </View>
        <Text style={styles.note}>{note}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.lg, marginBottom: spacing.sm },
  statusWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  tlRow: { flexDirection: "row", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 8 },
  tlCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  tlNote: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  tlDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4 },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end", marginTop: spacing.sm },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, minHeight: 44 },
  addBtn: { backgroundColor: colors.brandPrimary, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
});
