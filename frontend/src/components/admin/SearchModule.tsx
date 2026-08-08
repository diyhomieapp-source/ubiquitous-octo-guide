import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Switch } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function SearchModule() {
  const [tab, setTab] = useState<"health" | "synonyms" | "logs">("health");
  const [health, setHealth] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [synonyms, setSynonyms] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [noResults, setNoResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState("");
  const [syns, setSyns] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, c, s, l] = await Promise.all([
        api<any>("/hi/admin/search/health"),
        api<any>("/hi/admin/search/config"),
        api<any>("/hi/admin/search/synonyms"),
        api<any>("/hi/admin/search/logs"),
      ]);
      setHealth(h.health); setConfig(c.config); setEntityTypes(c.entity_types || []);
      setSynonyms(s.synonyms || []); setLogs(l.logs || []); setNoResults(l.no_results || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reindex = async () => {
    setBusy(true);
    try { const r = await api<any>("/hi/admin/search/reindex", { method: "POST" }); setHealth(r.health); }
    catch (e: any) { Alert.alert("Reindex failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const toggleExcluded = async (et: string) => {
    const cur: string[] = config.excluded_types || [];
    const next = cur.includes(et) ? cur.filter((x) => x !== et) : [...cur, et];
    setBusy(true);
    try { const r = await api<any>("/hi/admin/search/config", { method: "PUT", body: { excluded_types: next } }); setConfig(r.config); }
    catch (e: any) { Alert.alert("Update failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const toggleCommunity = async (v: boolean) => {
    setBusy(true);
    try { const r = await api<any>("/hi/admin/search/config", { method: "PUT", body: { community_in_search: v } }); setConfig(r.config); }
    catch (e: any) { Alert.alert("Update failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const addSynonym = async () => {
    if (!term.trim() || !syns.trim()) { Alert.alert("Missing info", "Enter a term and comma-separated synonyms."); return; }
    setBusy(true);
    try { await api("/hi/admin/search/synonyms", { method: "POST", body: { term: term.trim(), synonyms: syns.split(",").map((x) => x.trim()).filter(Boolean) } }); setTerm(""); setSyns(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const delSynonym = async (sid: string) => {
    setBusy(true);
    try { await api(`/hi/admin/search/synonyms/${sid}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't delete", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !health || !config) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Universal Search</Text>
        <Pressable testID="search-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.tabs}>{(["health", "synonyms", "logs"] as const).map((t) => (
        <Pressable key={t} testID={`search-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
          <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text>
        </Pressable>
      ))}</View>

      {tab === "health" && (
        <>
          <View style={styles.statRow}>
            <Stat label="Indexed" value={health.total} />
            <Stat label="Failed" value={health.failed} accent={health.failed > 0} />
            <Stat label="Status" value={health.index_status} />
          </View>
          <Pressable testID="search-reindex" disabled={busy} style={styles.primaryBtn} onPress={reindex}>
            <MaterialCommunityIcons name="database-refresh-outline" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>{busy ? "Reindexing…" : "Reindex approved records"}</Text>
          </Pressable>
          <Text style={styles.subhead}>Indexed by type</Text>
          {Object.entries(health.counts || {}).map(([et, n]) => (
            <View key={et} style={styles.card}>
              <View style={styles.labelRow}>
                <Text style={styles.rTitle}>{et}</Text>
                <Text style={styles.rMeta}>{n as any}</Text>
              </View>
              <View style={styles.actRow}>
                <Pressable testID={`search-exclude-${et}`} disabled={busy} style={[styles.smallBtn, (config.excluded_types || []).includes(et) && { borderColor: colors.error }]} onPress={() => toggleExcluded(et)}>
                  <Text style={[styles.smallBtnText, (config.excluded_types || []).includes(et) && { color: colors.error }]}>{(config.excluded_types || []).includes(et) ? "Excluded" : "In search"}</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={[styles.card, styles.switchRow]}>
            <Text style={styles.rTitle}>Community content in search</Text>
            <Switch testID="search-community-toggle" value={!!config.community_in_search} onValueChange={toggleCommunity} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <Text style={styles.note}>Reindex recomputes counts from approved sources. Excluded types are hidden from all users' global search.</Text>
        </>
      )}

      {tab === "synonyms" && (
        <>
          <View style={styles.addRow}>
            <TextInput testID="search-syn-term" value={term} onChangeText={setTerm} placeholder="term" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} autoCapitalize="none" />
            <TextInput testID="search-syn-values" value={syns} onChangeText={setSyns} placeholder="synonym1, synonym2" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { flex: 1.6 }]} autoCapitalize="none" />
            <Pressable testID="search-syn-add" disabled={busy} style={styles.addBtn} onPress={addSynonym}><Text style={styles.addBtnText}>Add</Text></Pressable>
          </View>
          {synonyms.map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={styles.labelRow}>
                <Text style={styles.rTitle}>{s.term}</Text>
                <Pressable testID={`search-syn-del-${s.id}`} disabled={busy} onPress={() => delSynonym(s.id)}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.error} /></Pressable>
              </View>
              <Text style={styles.rMeta}>{(s.synonyms || []).join(", ")}</Text>
            </View>
          ))}
        </>
      )}

      {tab === "logs" && (
        <>
          <Text style={styles.subhead}>No-result queries ({noResults.length})</Text>
          {noResults.length === 0 ? <Text style={styles.note}>No zero-result searches recently.</Text> : noResults.map((l) => (
            <View key={l.id} style={styles.card}><Text style={styles.rTitle}>{l.query_text_sanitized || "(empty)"}</Text><Text style={styles.rMeta}>{l.created_at}</Text></View>
          ))}
          <Text style={styles.subhead}>Recent searches</Text>
          {logs.slice(0, 40).map((l) => (
            <View key={l.id} style={styles.card}>
              <Text style={styles.rTitle}>{l.query_text_sanitized || "(empty)"}</Text>
              <Text style={styles.rMeta}>{l.result_count} results{l.selected_result_type ? ` · opened ${l.selected_result_type}` : ""}{l.context_type ? ` · ${l.context_type}` : ""}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 80, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  primaryBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  subhead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
