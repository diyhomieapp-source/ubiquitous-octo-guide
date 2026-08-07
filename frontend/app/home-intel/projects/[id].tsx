import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const SAFETY_COLOR: Record<string, string> = { "Safe to continue": colors.success, "Verify first": colors.warning, "Stop and contact a professional": colors.error };
const STEP_ICON: Record<string, any> = { completed: "check-circle", skipped: "skip-next-circle-outline", active: "circle-slice-8", not_started: "circle-outline" };

export default function ProjectWorkspace() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [q, setQ] = useState(""); const [answer, setAnswer] = useState<string | null>(null); const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api(`/hi/projects/${id}`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stepAction = async (stepId: string, status: string) => {
    setBusy(true);
    try { setData(await api(`/hi/projects/steps/${stepId}`, { method: "PUT", body: { status } })); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const pause = async () => {
    try { await api(`/hi/projects/${id}/status`, { method: "PUT", body: { status: "paused" } }); Alert.alert("Saved", "Project paused — resume anytime."); load(); } catch {}
  };
  const resume = async () => {
    try { await api(`/hi/projects/${id}/status`, { method: "PUT", body: { status: "active" } }); load(); } catch {}
  };
  const doAsk = async () => {
    if (!q.trim()) return;
    setAsking(true); setAnswer(null);
    try { const r = await api<{ answer: string }>(`/hi/projects/${id}/ask`, { method: "POST", body: { question: q.trim(), project_step_id: data?.current_step?.id } }); setAnswer(r.answer); }
    catch { setAnswer("Couldn't answer right now."); }
    finally { setAsking(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Project" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const p = data.project;
  const safeColor = SAFETY_COLOR[p.safety_status] || colors.warning;
  const mustStop = p.safety_status === "Stop and contact a professional";
  const cur = data.current_step;
  const done = p.status === "completed" || p.status === "unresolved" || p.status === "escalated";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Project" right={
        <Pressable testID="proj-materials-btn" onPress={() => router.push(`/home-intel/projects/materials?id=${id}`)}>
          <MaterialCommunityIcons name="cart-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.title}>{p.title}</Text>
        {(data.room || data.asset) && <Text style={styles.ctx}>{[data.room?.name, data.asset?.name].filter(Boolean).join(" · ")}</Text>}
        {!!p.description && <Text style={styles.summary}>{p.description}</Text>}

        <View style={[styles.safetyBanner, { backgroundColor: safeColor }]}>
          <MaterialCommunityIcons name={mustStop ? "hand-back-right" : "shield-check"} size={18} color={colors.onError} />
          <Text style={styles.safetyText}>{p.safety_status || "Verify first"}</Text>
        </View>

        <View style={styles.metaRow}>
          <Meta icon="chart-line-variant" v={p.difficulty || "—"} />
          <Meta icon="clock-outline" v={p.estimated_duration || "—"} />
          <Meta icon="cash" v={p.estimated_cost_low != null ? `$${p.estimated_cost_low}-${p.estimated_cost_high}` : "—"} />
          <Meta icon="alert-decagram-outline" v={p.risk_level || "—"} />
        </View>

        {/* progress */}
        <View style={styles.progressWrap}>
          <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${data.progress_pct}%` }]} /></View>
          <Text style={styles.progressText}>{data.progress_pct}% · {data.steps_done}/{data.steps_total} steps</Text>
        </View>

        {mustStop && (
          <Pressable testID="proj-pro" style={styles.proBtn} onPress={() => router.push("/pros")}>
            <MaterialCommunityIcons name="account-hard-hat" size={18} color={colors.onError} /><Text style={styles.proText}>Contact a Professional</Text>
          </Pressable>
        )}

        {p.preparation_checklist?.length > 0 && (
          <>
            <Text style={styles.section}>Preparation</Text>
            {p.preparation_checklist.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}
          </>
        )}

        {/* current step */}
        {!done && cur && !mustStop && (
          <View style={styles.stepCard}>
            <Text style={styles.stepLabel}>Current step</Text>
            <Text style={styles.stepInstr}>{cur.instruction}</Text>
            {!!cur.safety_note && <Text style={styles.stepSafety}>⚠ {cur.safety_note}</Text>}
            <View style={styles.stepBtns}>
              <Pressable testID="proj-step-complete" style={styles.primaryBtn} disabled={busy} onPress={() => stepAction(cur.id, "completed")}><Text style={styles.primaryBtnText}>Complete Step</Text></Pressable>
              <Pressable testID="proj-step-skip" style={styles.outlineBtn} disabled={busy} onPress={() => stepAction(cur.id, "skipped")}><Text style={styles.outlineText}>Skip for Now</Text></Pressable>
            </View>
            <View style={styles.stepBtns}>
              <Pressable testID="proj-ask" style={styles.outlineBtn} onPress={() => { setAsk(true); setAnswer(null); setQ(""); }}><Text style={styles.outlineText}>Ask Homie</Text></Pressable>
              <Pressable testID="proj-save-later" style={styles.outlineBtn} onPress={pause}><Text style={styles.outlineText}>Save for Later</Text></Pressable>
            </View>
          </View>
        )}
        {p.status === "paused" && !mustStop && (
          <Pressable testID="proj-resume" style={styles.primaryBtn} onPress={resume}><Text style={styles.primaryBtnText}>Resume Project</Text></Pressable>
        )}

        {/* phases */}
        <Text style={styles.section}>Plan</Text>
        {data.phases.map((ph: any) => (
          <View key={ph.id} style={styles.phase}>
            <Text style={styles.phaseName}>{ph.phase_name}</Text>
            {ph.steps.map((s: any) => (
              <View key={s.id} style={styles.stepRow}>
                <MaterialCommunityIcons name={STEP_ICON[s.status] || "circle-outline"} size={16} color={s.status === "completed" ? colors.success : s.status === "active" ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.stepRowText, (s.status === "completed" || s.status === "skipped") && styles.strike]}>{s.instruction}</Text>
              </View>
            ))}
          </View>
        ))}

        {p.stop_conditions?.length > 0 && (<><Text style={[styles.section, { color: colors.error }]}>Stop immediately if…</Text>{p.stop_conditions.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}</>)}
        {p.cleanup_disposal?.length > 0 && (<><Text style={styles.section}>Cleanup & disposal</Text>{p.cleanup_disposal.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}</>)}
        {!!p.maintenance_followup && (<><Text style={styles.section}>Maintenance follow-up</Text><Text style={styles.li}>{p.maintenance_followup}</Text></>)}

        <Pressable testID="proj-shopping" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/materials?id=${id}`)}>
          <MaterialCommunityIcons name="cart-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Shopping List</Text>
        </Pressable>
        {!done && (
          <Pressable testID="proj-complete" style={styles.wideBtnFill} onPress={() => router.push(`/home-intel/projects/complete?id=${id}`)}>
            <Text style={styles.wideFillText}>Did you complete this project?</Text>
          </Pressable>
        )}
        {done && <Text style={styles.doneNote}>This project is {p.status} and saved to your property history.</Text>}
      </ScrollView>

      <Modal visible={ask} transparent animationType="slide" onRequestClose={() => setAsk(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ask Homie</Text>
            <TextInput testID="proj-ask-input" style={styles.modalInput} value={q} onChangeText={setQ} placeholder="e.g. How do I find a stud?" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            {answer && <Text style={styles.answer}>{answer}</Text>}
            <Pressable testID="proj-ask-send" style={styles.primaryBtn} disabled={asking} onPress={doAsk}>{asking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Ask</Text>}</Pressable>
            <Pressable style={styles.modalClose} onPress={() => setAsk(false)}><Text style={styles.outlineText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Meta({ icon, v }: { icon: any; v: string }) {
  return <View style={styles.meta}><MaterialCommunityIcons name={icon} size={16} color={colors.brandPrimary} /><Text style={styles.metaText} numberOfLines={1}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  ctx: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  summary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.sm },
  safetyBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  safetyText: { color: colors.onError, fontFamily: font.bold, fontSize: type.base },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  metaText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.xs, maxWidth: 120 },
  progressWrap: { marginTop: spacing.lg },
  progressBar: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.brandPrimary },
  progressText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  proBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  proText: { color: colors.onError, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: 2 },
  stepCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  stepLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  stepInstr: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, lineHeight: 24, marginTop: spacing.xs },
  stepSafety: { color: colors.warning, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  stepBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  outlineText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  phase: { marginBottom: spacing.md },
  phaseName: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 3 },
  stepRowText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  strike: { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" },
  wideBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  wideText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  wideBtnFill: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.md },
  wideFillText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  doneNote: { color: colors.success, fontFamily: font.medium, fontSize: type.sm, textAlign: "center", marginTop: spacing.lg },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  modalInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 70, textAlignVertical: "top" },
  answer: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md },
  modalClose: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
});
