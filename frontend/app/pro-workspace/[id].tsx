import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Modal } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const TABS = ["Overview", "Capture", "QA", "Deliver"];
const SEV_COLOR: Record<string, string> = { blocker: "#EB5757", warning: "#F2994A", info: "#2F80ED" };
const REQ_COLOR: Record<string, string> = { pending: "#888", in_progress: "#F2994A", complete: "#27AE60", needs_review: "#2F80ED" };
const PACKAGES = ["existing_conditions_summary", "measurement_report", "photo_report", "client_handoff"];

export default function ProProject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<any[]>([]);
  const [dismissFor, setDismissFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/hi/pro/projects/${id}`);
      setD(r);
      const e = await api<any>(`/hi/pro/projects/${id}/exports`);
      setExports(e.exports || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); await load(); } catch (e: any) { Alert.alert("Action failed", e?.message || "Try again."); } finally { setBusy(false); } };
  const completeReq = (r: any) => act(() => api(`/hi/pro/requirements/${r.id}`, { method: "PUT", body: { status: r.status === "complete" ? "pending" : "complete" } }));
  const addCapture = (cat: string) => act(() => api(`/hi/pro/projects/${id}/capture`, { method: "POST", body: { category: cat, kind: "measurement", label: `${cat} entry`, confidence: "medium" } }));
  const runQA = () => act(() => api(`/hi/pro/projects/${id}/qa/run`, { method: "POST" }));
  const resolve = (iid: string) => act(() => api(`/hi/pro/qa/${iid}/resolve`, { method: "POST", body: { note: "Reviewed and accepted" } }));
  const dismiss = () => { if (!dismissFor) return; act(() => api(`/hi/pro/qa/${dismissFor}/dismiss`, { method: "POST", body: { note: note.trim() } })).then(() => { setDismissFor(null); setNote(""); }); };
  const createPkg = (pt: string) => act(() => api(`/hi/pro/projects/${id}/deliverables`, { method: "POST", body: { package_type: pt } }));
  const setPkgStatus = (did: string, status: string) => act(() => api(`/hi/pro/deliverables/${did}/status`, { method: "PUT", body: { status } }));
  const share = (did: string) => act(() => api(`/hi/pro/projects/${id}/share`, { method: "POST", body: { deliverable_id: did } }).then((r) => Alert.alert("Shared", r.note)));
  const exportPdf = () => act(() => api(`/hi/pro/projects/${id}/exports`, { method: "POST", body: { export_type: "pdf" } }));

  if (loading || !d) return <View style={styles.root}><ScreenHeader title="Project" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const p = d.project; const comp = d.completeness;

  return (
    <View style={styles.root}>
      <ScreenHeader title={p.project_name} />
      <View style={styles.tabBar}>
        {TABS.map((t) => <Pressable key={t} testID={`pro-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}><Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text></Pressable>)}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {tab === "Overview" ? (
          <>
            <View style={styles.statRow}>
              <Stat label="Complete %" value={comp.capture_completeness} />
              <Stat label="Open QA" value={comp.open_qa} accent={comp.open_qa > 0} />
              <Stat label="Blockers" value={comp.blockers} accent={comp.blockers > 0} />
            </View>
            <View style={[styles.readyCard, { borderColor: comp.deliverable_ready ? "#27AE60" : colors.border }]}>
              <MaterialCommunityIcons name={comp.deliverable_ready ? "check-circle" : "progress-clock"} size={20} color={comp.deliverable_ready ? "#27AE60" : colors.onSurfaceTertiary} />
              <Text style={styles.readyText}>{comp.deliverable_ready ? "Ready to prepare deliverables" : `${comp.complete}/${comp.required} required captures complete`}</Text>
            </View>
            <Text style={styles.section}>Recent activity</Text>
            {(d.activity || []).slice(0, 8).map((a: any) => <Text key={a.id} style={styles.actItem}>• {a.action.replace(/_/g, " ")}{a.detail ? ` (${a.detail})` : ""}</Text>)}
            <Text style={styles.disclaimer}>{d.disclaimer}</Text>
          </>
        ) : null}

        {tab === "Capture" ? (
          <>
            <Text style={styles.section}>Required captures</Text>
            {(d.requirements || []).map((r: any) => (
              <View key={r.id} style={styles.reqRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqName}>{r.category.replace(/_/g, " ")}{r.required ? " *" : ""}</Text>
                  <Text style={[styles.reqStatus, { color: REQ_COLOR[r.status] }]}>{r.status.replace(/_/g, " ")}</Text>
                </View>
                <Pressable testID={`pro-capture-${r.category}`} disabled={busy} style={styles.smallBtn} onPress={() => addCapture(r.category)}><Text style={styles.smallBtnText}>+ Add</Text></Pressable>
                <Pressable testID={`pro-complete-${r.category}`} disabled={busy} style={[styles.smallBtn, { borderColor: r.status === "complete" ? "#27AE60" : colors.brandPrimary }]} onPress={() => completeReq(r)}><Text style={[styles.smallBtnText, { color: r.status === "complete" ? "#27AE60" : colors.brandPrimary }]}>{r.status === "complete" ? "✓" : "Done"}</Text></Pressable>
              </View>
            ))}
            <Text style={styles.section}>Evidence ({(d.evidence || []).length})</Text>
            {(d.evidence || []).slice(0, 12).map((e: any) => <Text key={e.id} style={styles.evItem}>• {e.category}: {e.label || e.kind} {e.value ? `(${e.value})` : ""} · {e.confidence}</Text>)}
          </>
        ) : null}

        {tab === "QA" ? (
          <>
            <Pressable testID="pro-qa-run" disabled={busy} style={styles.primaryBtn} onPress={runQA}><Text style={styles.primaryText}>Run QA check</Text></Pressable>
            <Text style={styles.disclaimer}>QA flags data-quality issues only — it never certifies accuracy. You make the final acceptance decision.</Text>
            {(d.qa_issues || []).length === 0 ? <Text style={styles.empty}>No open QA issues.</Text> :
              (d.qa_issues || []).map((i: any) => (
                <View key={i.id} style={[styles.qaCard, { borderLeftColor: SEV_COLOR[i.severity] }]}>
                  <Text style={[styles.qaSev, { color: SEV_COLOR[i.severity] }]}>{i.severity} · {i.issue_type.replace(/_/g, " ")}</Text>
                  <Text style={styles.qaDesc}>{i.description}</Text>
                  <Text style={styles.qaAction}>{i.recommended_action}</Text>
                  <View style={styles.qaBtns}>
                    <Pressable testID={`pro-qa-resolve-${i.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => resolve(i.id)}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Resolve</Text></Pressable>
                    <Pressable testID={`pro-qa-dismiss-${i.id}`} disabled={busy} style={styles.smallBtn} onPress={() => setDismissFor(i.id)}><Text style={styles.smallBtnText}>Dismiss</Text></Pressable>
                  </View>
                </View>
              ))}
          </>
        ) : null}

        {tab === "Deliver" ? (
          <>
            <Text style={styles.section}>Create package</Text>
            <View style={styles.chipRow}>{PACKAGES.map((pt) => <Pressable key={pt} testID={`pro-pkg-${pt}`} disabled={busy} style={styles.chip} onPress={() => createPkg(pt)}><Text style={styles.chipText}>+ {pt.replace(/_/g, " ")}</Text></Pressable>)}</View>
            <Text style={styles.section}>Deliverables</Text>
            {(d.deliverables || []).length === 0 ? <Text style={styles.empty}>No packages yet.</Text> :
              (d.deliverables || []).map((pk: any) => (
                <View key={pk.id} style={styles.pkgCard}>
                  <Text style={styles.pkgName}>{pk.package_type.replace(/_/g, " ")} · {pk.status}</Text>
                  <Text style={styles.pkgMeta}>{pk.content_summary?.measurements ?? 0} measurements · {pk.content_summary?.photos ?? 0} photos · {pk.content_summary?.completeness ?? 0}% complete</Text>
                  <View style={styles.qaBtns}>
                    {pk.status === "draft" ? <Pressable testID={`pro-pkg-approve-${pk.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => setPkgStatus(pk.id, "approved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Approve</Text></Pressable> : null}
                    {(pk.status === "approved" || pk.status === "shared") ? <Pressable testID={`pro-pkg-share-${pk.id}`} disabled={busy} style={styles.smallBtn} onPress={() => share(pk.id)}><Text style={styles.smallBtnText}>Share w/ client</Text></Pressable> : null}
                  </View>
                </View>
              ))}
            <Text style={styles.section}>Exports</Text>
            <Pressable testID="pro-export-pdf" disabled={busy} style={styles.primaryBtn} onPress={exportPdf}><Text style={styles.primaryText}>Export PDF report</Text></Pressable>
            {exports.map((ex) => <Text key={ex.id} style={styles.evItem}>• {ex.export_type} · {ex.status} · twin {ex.digital_twin_version}</Text>)}
            <Text style={styles.disclaimer}>{d.disclaimer}</Text>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={!!dismissFor} transparent animationType="fade" onRequestClose={() => setDismissFor(null)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Dismiss QA issue</Text>
          <Text style={styles.disclaimer}>A note is required — this is part of your QA audit trail.</Text>
          <TextInput testID="pro-dismiss-note" value={note} onChangeText={setNote} placeholder="Why is this acceptable?" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
          <View style={styles.qaBtns}>
            <Pressable style={[styles.smallBtn, { flex: 1 }]} onPress={() => setDismissFor(null)}><Text style={styles.smallBtnText}>Cancel</Text></Pressable>
            <Pressable testID="pro-dismiss-confirm" disabled={busy || !note.trim()} style={[styles.smallBtn, { flex: 1, borderColor: colors.brandPrimary }]} onPress={dismiss}><Text style={[styles.smallBtnText, { color: colors.brandPrimary }]}>Dismiss</Text></Pressable>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && value > 0 && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tabBar: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.xs, borderBottomColor: colors.border, borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary, fontFamily: font.bold },
  statRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 20 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2 },
  readyCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  readyText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  actItem: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 3, textTransform: "capitalize" },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.md },
  reqRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  reqName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textTransform: "capitalize" },
  reqStatus: { fontFamily: font.medium, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  evItem: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 3, textTransform: "capitalize" },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  qaCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  qaSev: { fontFamily: font.bold, fontSize: type.xs, textTransform: "uppercase" },
  qaDesc: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, marginTop: 3 },
  qaAction: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  qaBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, alignItems: "center" },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  pkgCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  pkgName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  pkgMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  modalWrap: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm, minHeight: 60 },
});
