import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Network from "expo-network";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { queueCount, flush } from "@/src/utils/offlineQueue";

const CHOICE_LABEL: Record<string, string> = { keep_mine: "Keep my change", use_latest: "Use latest saved", save_as_note: "Save as note", discard: "Discard mine" };

export default function SyncCenter() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [safety, setSafety] = useState<any[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const checkNet = useCallback(async () => {
    try { const s = await Network.getNetworkStateAsync(); setOnline(!!(s.isConnected && s.isInternetReachable !== false)); }
    catch { setOnline(true); }
  }, []);

  const load = useCallback(async () => {
    await checkNet();
    setPending(await queueCount());
    try {
      const [st, cf, q, sc] = await Promise.all([
        api<any>("/hi/sync/status"), api<any>("/hi/sync/conflicts"),
        api<any>("/hi/sync/saved-questions"), api<any>("/hi/sync/safety-content"),
      ]);
      setStatus(st); setConflicts(cf.conflicts || []); setQuestions(q.questions || []); setSafety(sc.safety_content || []);
    } catch {} finally { setLoading(false); }
  }, [checkNet]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const t = setInterval(checkNet, 8000); return () => clearInterval(t); }, [checkNet]);

  const doFlush = async () => {
    setBusy(true);
    try { const r = await flush(); Alert.alert("Sync complete", `${r.pushed} saved, ${r.conflicts} need review, ${r.remaining} waiting.`); await load(); }
    catch (e: any) { Alert.alert("Couldn't sync", e?.message || "Try again when you're online."); } finally { setBusy(false); }
  };
  const resolve = async (cid: string, choice: string) => {
    setBusy(true);
    try { await api(`/hi/sync/conflicts/${cid}/resolve`, { method: "POST", body: { choice } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't resolve", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const deleteQuestion = async (qid: string) => {
    setBusy(true);
    try { await api(`/hi/sync/saved-questions/${qid}`, { method: "DELETE" }); await load(); }
    catch {} finally { setBusy(false); }
  };

  const connLabel = online === null ? "Checking…" : online ? (pending > 0 ? "Changes waiting to sync" : "Online") : "Offline";
  const connColor = online === null ? colors.onSurfaceTertiary : online ? (pending > 0 ? "#F2994A" : "#27AE60") : "#EB5757";
  const connIcon = online ? (pending > 0 ? "cloud-sync-outline" : "cloud-check-outline") : "cloud-off-outline";

  if (loading) return <View style={styles.root}><ScreenHeader title="Connection & Sync" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Connection & Sync" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={[styles.connCard, { borderColor: connColor }]}>
          <MaterialCommunityIcons name={connIcon as any} size={26} color={connColor} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.connLabel, { color: connColor }]}>{connLabel}</Text>
            <Text style={styles.connSub}>{pending} change{pending === 1 ? "" : "s"} on this device · {status?.pending_conflicts || 0} need review</Text>
          </View>
          {online && pending > 0 ? <Pressable testID="sync-flush" disabled={busy} style={styles.syncBtn} onPress={doFlush}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.syncBtnText}>Sync now</Text>}</Pressable> : null}
        </View>
        <Text style={styles.note}>Your work is saved on this device and safely synced when you're back online. We never silently overwrite what you entered.</Text>

        {/* Conflicts */}
        <Text style={styles.section}>Needs your review ({conflicts.length})</Text>
        {conflicts.length === 0 ? <Text style={styles.empty}>No conflicts. Everything synced cleanly.</Text> :
          conflicts.map((c) => (
            <View key={c.id} style={styles.conflictCard}>
              <Text style={styles.cType}>{c.conflict_type.replace(/_/g, " ")} · {c.entity_type}</Text>
              <Text style={styles.cReason}>{c.reason}</Text>
              <View style={styles.choiceRow}>
                {(c.conflict_type === "permission_conflict" ? ["use_latest", "save_as_note", "discard"] : ["keep_mine", "use_latest", "save_as_note", "discard"]).map((ch) => (
                  <Pressable key={ch} testID={`sync-resolve-${c.id}-${ch}`} disabled={busy} style={styles.choiceBtn} onPress={() => resolve(c.id, ch)}><Text style={styles.choiceText}>{CHOICE_LABEL[ch]}</Text></Pressable>
                ))}
              </View>
            </View>
          ))}

        {/* Saved questions */}
        <Text style={styles.section}>Saved for Homie ({questions.length})</Text>
        {questions.length === 0 ? <Text style={styles.empty}>Questions you save while offline appear here.</Text> :
          questions.map((q) => (
            <View key={q.id} style={styles.qRow}>
              <Text style={styles.qText} numberOfLines={2}>{q.question}</Text>
              <Pressable testID={`sync-q-del-${q.id}`} disabled={busy} style={styles.smallBtn} onPress={() => deleteQuestion(q.id)}><Text style={styles.smallBtnText}>Remove</Text></Pressable>
            </View>
          ))}

        {/* Offline safety */}
        <Text style={styles.section}>Emergency guidance (works offline)</Text>
        {safety.map((s) => (
          <View key={s.id} style={styles.safetyCard}>
            <Text style={styles.safetyTitle}>⚠ {s.title}</Text>
            {s.steps.map((st: string, i: number) => <Text key={i} style={styles.safetyStep}>{i + 1}. {st}</Text>)}
          </View>
        ))}
        <Text style={styles.note}>For any real emergency, call your local emergency number first.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  connCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  connLabel: { fontFamily: font.bold, fontSize: type.base },
  connSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  syncBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  syncBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  conflictCard: { backgroundColor: colors.surfaceSecondary, borderColor: "#F2994A", borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cType: { color: "#F2994A", fontFamily: font.bold, fontSize: type.xs, textTransform: "uppercase" },
  cReason: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, marginTop: 4 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  choiceBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  choiceText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  qRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  qText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  safetyCard: { backgroundColor: "#EB575710", borderColor: "#EB575755", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  safetyTitle: { color: "#EB5757", fontFamily: font.bold, fontSize: type.base },
  safetyStep: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 18 },
});
