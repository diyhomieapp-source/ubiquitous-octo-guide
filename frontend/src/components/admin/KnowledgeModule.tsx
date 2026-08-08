import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function KnowledgeModule() {
  const [dash, setDash] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newSource, setNewSource] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q, s] = await Promise.all([
        api<any>("/hi/admin/knowledge/dashboard"),
        api<{ entities: any[] }>("/hi/admin/knowledge/review-queue"),
        api<{ sources: any[] }>("/hi/admin/knowledge/sources"),
      ]);
      setDash(d); setQueue(q.entities); setSources(s.sources);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const review = async (eid: string, action: string) => {
    setBusy(true);
    try { await api(`/hi/admin/knowledge/entities/${eid}/review`, { method: "POST", body: { action } }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const addSource = async () => {
    if (!newSource.trim()) return;
    setBusy(true);
    try { await api("/hi/admin/knowledge/sources", { method: "POST", body: { title: newSource.trim(), source_type: "approved_template" } }); setNewSource(""); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Knowledge Graph</Text>
        <Pressable testID="kg-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Entities" value={dash.entities} />
        <Stat label="Published" value={dash.published} />
        <Stat label="In review" value={dash.in_review} accent={dash.in_review > 0} />
        <Stat label="Sources" value={dash.sources} />
        <Stat label="Links" value={dash.relationships} />
      </View>

      <Text style={styles.section}>Review queue ({queue.length})</Text>
      <Text style={styles.help}>AI-extracted safety/repair/code content is never auto-published — approve it here.</Text>
      {queue.length === 0 ? <Text style={styles.help}>Nothing waiting for review. 🎉</Text> :
        queue.map((e) => (
          <View key={e.id} testID={`kg-review-${e.id}`} style={styles.card}>
            <Text style={styles.cardTitle}>{e.canonical_name}</Text>
            <Text style={styles.cardMeta}>{e.entity_type} · {e.visibility} · conf {e.confidence_level}</Text>
            {!!e.description && <Text style={styles.cardDesc} numberOfLines={3}>{e.description}</Text>}
            <View style={styles.btnRow}>
              <Pressable testID={`kg-publish-${e.id}`} disabled={busy} style={[styles.actBtn, { borderColor: colors.success }]} onPress={() => review(e.id, "publish")}><Text style={[styles.actText, { color: colors.success }]}>Publish</Text></Pressable>
              <Pressable testID={`kg-reject-${e.id}`} disabled={busy} style={[styles.actBtn, { borderColor: colors.error }]} onPress={() => review(e.id, "reject")}><Text style={[styles.actText, { color: colors.error }]}>Reject</Text></Pressable>
              <Pressable testID={`kg-archive-${e.id}`} disabled={busy} style={styles.actBtn} onPress={() => review(e.id, "archive")}><Text style={styles.actText}>Archive</Text></Pressable>
            </View>
          </View>
        ))}

      <Text style={styles.section}>Sources ({sources.length})</Text>
      <View style={styles.row}>
        <TextInput testID="kg-source-name" style={styles.input} value={newSource} onChangeText={setNewSource} placeholder="Add approved reference title" placeholderTextColor={colors.onSurfaceTertiary} />
        <Pressable testID="kg-source-add" style={styles.saveBtn} disabled={busy} onPress={addSource}><Text style={styles.saveText}>Add</Text></Pressable>
      </View>
      {sources.slice(0, 12).map((s) => (
        <View key={s.id} style={styles.srcRow}>
          <MaterialCommunityIcons name="file-document-outline" size={15} color={colors.brandPrimary} />
          <Text style={styles.srcTitle} numberOfLines={1}>{s.title}</Text>
          <Text style={styles.srcMeta}>{s.source_type} · rank {s.reliability_rank} · {s.status}</Text>
        </View>
      ))}

      <Text style={styles.note}>Private user knowledge stays private; only user-submitted contributions appear in the review queue. Every published fact keeps its source lineage + version history (rollback supported).</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 60, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  cardDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs, lineHeight: 19 },
  btnRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  actBtn: { flex: 1, alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  actText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  srcRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  srcTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, maxWidth: "45%" },
  srcMeta: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textAlign: "right", textTransform: "capitalize" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.xl },
});
