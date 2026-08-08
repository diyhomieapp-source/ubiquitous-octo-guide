import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Modal } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const EVENT_ICON: Record<string, string> = {
  "Project started": "hammer-wrench", "Project completed": "check-decagram", "Asset installed": "cube-outline",
  "Document uploaded": "file-document-outline", "Measurement recorded": "tape-measure", "Measurement confirmed": "check-circle-outline",
  "Maintenance completed": "calendar-check-outline", "Professional work completed": "account-hard-hat-outline", "Note": "note-text-outline",
};

export default function PropertyTimeline() {
  const [events, setEvents] = useState<any[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const load = useCallback(async (ft?: string) => {
    try {
      const q = ft ? `?event_type=${encodeURIComponent(ft)}` : "";
      const r = await api<any>(`/hi/home-dashboard/timeline${q}`);
      setEvents(r.events || []); setTypes(r.event_types || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const addNote = async () => {
    if (!title.trim()) { Alert.alert("Title needed", "Give your note a title."); return; }
    setBusy(true);
    try { await api("/hi/home-dashboard/timeline/note", { method: "POST", body: { title: title.trim(), description: desc.trim() || null } }); setNoteOpen(false); setTitle(""); setDesc(""); await load(filter); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const deleteNote = (id: string) => {
    Alert.alert("Delete note?", "", [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/hi/home-dashboard/timeline/note/${id}`, { method: "DELETE" }); await load(filter); } catch {} } }]);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Timeline" right={
        <Pressable testID="tl-add-note" onPress={() => setNoteOpen(true)}><MaterialCommunityIcons name="plus" size={24} color={colors.brandPrimary} /></Pressable>
      } />
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.lg }}>
          <Pressable testID="tl-filter-all" style={[styles.chip, !filter && styles.chipOn]} onPress={() => setFilter("")}><Text style={[styles.chipText, !filter && styles.chipTextOn]}>All</Text></Pressable>
          {types.map((t) => <Pressable key={t} testID={`tl-filter-${t}`} style={[styles.chip, filter === t && styles.chipOn]} onPress={() => setFilter(t)}><Text style={[styles.chipText, filter === t && styles.chipTextOn]}>{t}</Text></Pressable>)}
        </ScrollView>
      </View>
      {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          {events.length === 0 ? <Text style={styles.empty}>No history yet. As you add rooms, assets, projects and maintenance, your home's story appears here.</Text> :
            events.map((e) => (
              <View key={e.id} style={styles.row}>
                <View style={styles.dotCol}>
                  <View style={styles.dot}><MaterialCommunityIcons name={(EVENT_ICON[e.event_type] || "circle-small") as any} size={14} color={colors.brandPrimary} /></View>
                  <View style={styles.line} />
                </View>
                <View style={styles.eventCard}>
                  <Text style={styles.eventType}>{e.event_type}</Text>
                  <Text style={styles.eventTitle}>{e.title}</Text>
                  {e.description ? <Text style={styles.eventDesc}>{e.description}</Text> : null}
                  <Text style={styles.eventDate}>{String(e.occurred_at || "").slice(0, 10)}</Text>
                  {e.is_note ? <Pressable testID={`tl-del-${e.id}`} style={styles.delNote} onPress={() => deleteNote(e.id)}><Text style={styles.delNoteText}>Delete note</Text></Pressable> : null}
                </View>
              </View>
            ))}
        </ScrollView>
      )}

      <Modal visible={noteOpen} transparent animationType="slide" onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add a note</Text>
          <TextInput testID="tl-note-title" value={title} onChangeText={setTitle} placeholder="Title (e.g. Repainted the fence)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="tl-note-desc" value={desc} onChangeText={setDesc} placeholder="Details (optional)" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { minHeight: 70 }]} multiline />
          <View style={styles.sheetBtns}>
            <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setNoteOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
            <Pressable testID="tl-note-save" disabled={busy || !title.trim()} style={[styles.sheetBtn, styles.go, (busy || !title.trim()) && { opacity: 0.5 }]} onPress={addNote}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.goText}>Save</Text>}</Pressable>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  filterBar: { paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  chipTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  dotCol: { alignItems: "center", width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary + "1A", alignItems: "center", justifyContent: "center" },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  eventCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  eventType: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  eventTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 2 },
  eventDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  eventDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4 },
  delNote: { marginTop: spacing.sm, alignSelf: "flex-start" },
  delNoteText: { color: "#EB5757", fontFamily: font.bold, fontSize: type.xs },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  cancel: { borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  go: { backgroundColor: colors.brandPrimary },
  goText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
