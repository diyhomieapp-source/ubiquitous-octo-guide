import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const OVERLAY_ICON: Record<string, string> = {
  orientation_marker: "compass-outline", placement_marker: "target", measurement_marker: "ruler",
  component_highlight: "select-marker", sequence_overlay: "layers-outline", safe_zone: "shield-check-outline",
  before_after_overlay: "compare", checklist_anchor: "format-list-checks", inspection_marker: "magnify-scan",
};
const STATUS_COPY: Record<string, { title: string; tone: string }> = {
  AVAILABLE: { title: "AR ready", tone: "#27AE60" },
  LIMITED: { title: "2D guided view", tone: "#F2994A" },
  UNAVAILABLE: { title: "AR unavailable", tone: "#888" },
  NOT_RECOMMENDED: { title: "AR not recommended here", tone: "#EB5757" },
  PROFESSIONAL_REQUIRED: { title: "Professional recommended", tone: "#EB5757" },
};

export default function ARGuidance() {
  const { project_id, room_id, asset_id, guidance_type } = useLocalSearchParams<{ project_id?: string; room_id?: string; asset_id?: string; guidance_type?: string }>();
  const router = useRouter();
  const [elig, setElig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [instructions, setInstructions] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

  const device = { platform: Platform.OS, supports_ar: Platform.OS !== "web", camera_permission: "undetermined" };
  const gtype = (guidance_type as string) || "sequence_overlay";

  const load = useCallback(async () => {
    try {
      const res = await api("/hi/ar/eligibility", { method: "POST", body: { project_id, room_id, asset_id, guidance_type: gtype, device } });
      setElig(res.eligibility);
    } catch {} finally { setLoading(false); }
  }, [project_id, room_id, asset_id]);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await api("/hi/ar/sessions", { method: "POST", body: { project_id, room_id, asset_id, guidance_type: gtype, device } });
      setSession(res.session);
      setInstructions(res.instructions || []);
      setIdx(0);
      await api(`/hi/ar/sessions/${res.session.id}/calibrate`, { method: "POST", body: { anchor_confirmed: true } });
    } catch (e) {
      const msg = e instanceof ApiError ? (typeof e.message === "string" ? e.message : "Use the written steps.") : "Try again.";
      Alert.alert("AR guidance", String(msg));
    } finally { setBusy(false); }
  };

  const confirmStep = async () => {
    const ins = instructions[idx]; if (!ins || !session) return;
    setBusy(true);
    try {
      const res = await api(`/hi/ar/sessions/${session.id}/instructions/${ins.id}/confirm`, { method: "POST" });
      if (res.all_confirmed) setFinishOpen(true);
      else setIdx((i) => Math.min(i + 1, instructions.length - 1));
    } catch (e: any) { Alert.alert("Couldn't confirm", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const skipStep = async () => {
    const ins = instructions[idx]; if (!ins || !session) return;
    setBusy(true);
    try { await api(`/hi/ar/sessions/${session.id}/instructions/${ins.id}/skip`, { method: "POST" }); setIdx((i) => Math.min(i + 1, instructions.length - 1)); }
    catch {} finally { setBusy(false); }
  };

  const reportTracking = async () => {
    if (!session) return;
    try { const res = await api(`/hi/ar/sessions/${session.id}/report-tracking`, { method: "POST", body: { reason: "user_reported" } }); Alert.alert("Tracking", res.message); setShowText(true); } catch {}
  };

  const finish = async (workItemConfirmed: boolean) => {
    if (!session) return;
    setBusy(true);
    try {
      const res = await api(`/hi/ar/sessions/${session.id}/complete`, { method: "POST", body: { work_item_confirmed: workItemConfirmed } });
      setFinishOpen(false);
      Alert.alert("Done", res.note, [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert("Couldn't finish", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="AR Guidance" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const sc = STATUS_COPY[elig?.status] || STATUS_COPY.UNAVAILABLE;
  const blocked = ["UNAVAILABLE", "NOT_RECOMMENDED", "PROFESSIONAL_REQUIRED"].includes(elig?.status);
  const cur = instructions[idx];

  return (
    <View style={styles.root}>
      <ScreenHeader title="AR Guidance" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={[styles.statusCard, { borderColor: sc.tone + "66", backgroundColor: sc.tone + "12" }]}>
          <MaterialCommunityIcons name={elig?.status === "PROFESSIONAL_REQUIRED" ? "account-hard-hat" : "cube-scan"} size={22} color={sc.tone} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: sc.tone }]}>{sc.title}</Text>
            {(elig?.reasons || []).map((rn: string, i: number) => <Text key={i} style={styles.reason}>• {rn}</Text>)}
          </View>
        </View>

        {/* Blocked → fallback */}
        {blocked ? (
          <View style={styles.card}>
            {elig?.status === "PROFESSIONAL_REQUIRED" ? (
              <>
                <Text style={styles.cardTitle}>Let's keep you safe</Text>
                <Text style={styles.body}>This job is best handled by a professional. You can still read the written steps, or connect with a pro.</Text>
                <Pressable testID="ar-pro" style={styles.primaryBtn} onPress={() => router.push("/pros")}><Text style={styles.primaryText}>Find a Pro</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Use the written steps</Text>
                <Text style={styles.body}>AR isn't the right fit here, but your full step-by-step guide is always available.</Text>
              </>
            )}
            {project_id ? <Pressable testID="ar-text-fallback" style={styles.outlineBtn} onPress={() => router.replace(`/home-intel/projects/${project_id}`)}><Text style={styles.outlineText}>Open written steps</Text></Pressable> : null}
          </View>
        ) : !session ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Guided visual walkthrough</Text>
            <Text style={styles.body}>Homie will walk you through one step at a time. {elig?.status === "LIMITED" ? "Live camera AR turns on in the installed app — for now you'll get a clear 2D guided view." : "Point your camera and follow each overlay."}</Text>
            <Pressable testID="ar-start" disabled={busy} style={styles.primaryBtn} onPress={start}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryText}>Start guided view</Text>}
            </Pressable>
            <Text style={styles.note}>AR is an assistive layer — it never claims exact stud, wire, pipe or code-safe locations. Always confirm placement yourself before anything permanent.</Text>
          </View>
        ) : (
          <>
            {/* runner */}
            <View style={styles.progressRow}>
              <View style={styles.track}><View style={[styles.fill, { width: `${((idx + 1) / instructions.length) * 100}%` }]} /></View>
              <Text style={styles.progressText}>{idx + 1}/{instructions.length}</Text>
            </View>

            <View style={styles.stage}>
              <MaterialCommunityIcons name={(OVERLAY_ICON[cur?.overlay_type] || "layers-outline") as any} size={44} color={colors.brandPrimary} />
              <Text style={styles.overlayChip}>{(cur?.overlay_type || "").replace(/_/g, " ")}</Text>
              {elig?.estimated ? <View style={styles.estTag}><Text style={styles.estText}>ESTIMATED</Text></View> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{cur?.title}</Text>
              <Text style={styles.body}>{cur?.instruction}</Text>
              {cur?.action ? (
                <View testID="ar-action-payload" style={styles.actionWrap}>
                  <View style={styles.actionChips}>
                    <View style={styles.aChip}><MaterialCommunityIcons name="gesture-tap-hold" size={13} color={colors.brandPrimary} /><Text style={styles.aChipText}>{String(cur.action.action_id).replace(/_/g, " ").toLowerCase()}</Text></View>
                    {cur.action.tool ? <View style={styles.aChip}><MaterialCommunityIcons name="tools" size={13} color={colors.brandPrimary} /><Text style={styles.aChipText}>{String(cur.action.tool).replace(/_/g, " ")}</Text></View> : null}
                    {cur.action.direction ? <View style={styles.aChip}><MaterialCommunityIcons name={cur.action.direction === "counterclockwise" ? "rotate-left" : cur.action.direction === "clockwise" ? "rotate-right" : "arrow-right"} size={13} color={colors.brandPrimary} /><Text style={styles.aChipText}>{cur.action.direction}</Text></View> : null}
                    <View style={styles.aChip}><MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.brandPrimary} /><Text style={styles.aChipText}>{cur.action.anchor?.type} anchor</Text></View>
                  </View>
                  <Text style={styles.visualsHint}>Overlays: {(cur.action.visuals || []).map((v: string) => v.replace(/_/g, " ")).join(" · ")}</Text>
                  {cur.action.ppe?.length ? (
                    <View style={[styles.actionChips, { marginTop: 6 }]}>
                      {cur.action.ppe.map((p: string) => (
                        <View key={p} style={[styles.aChip, { backgroundColor: "rgba(242,153,74,0.15)" }]}>
                          <MaterialCommunityIcons name="shield-account-outline" size={13} color="#F2994A" />
                          <Text style={styles.aChipText}>{p}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {cur?.safety_note ? (
                <View style={styles.safety}><MaterialCommunityIcons name="shield-alert-outline" size={16} color="#EB5757" /><Text style={styles.safetyText}>{cur.safety_note}</Text></View>
              ) : null}
              <View style={styles.actRow}>
                <Pressable testID="ar-confirm" disabled={busy} style={styles.primaryBtnSm} onPress={confirmStep}><Text style={styles.primaryText}>{cur?.requires_confirmation ? "Confirm & next" : "Next"}</Text></Pressable>
                <Pressable testID="ar-skip" disabled={busy} style={styles.outlineBtnSm} onPress={skipStep}><Text style={styles.outlineText}>Skip</Text></Pressable>
              </View>
            </View>

            {/* controls */}
            <View style={styles.controls}>
              <Ctrl icon="text-box-outline" label="Text" onPress={() => setShowText((v) => !v)} testID="ar-show-text" />
              <Ctrl icon="crosshairs-gps" label="Recenter" onPress={() => session && api(`/hi/ar/sessions/${session.id}/recenter`, { method: "POST" })} testID="ar-recenter" />
              <Ctrl icon="alert-outline" label="Tracking" onPress={reportTracking} testID="ar-tracking" />
              <Ctrl icon="pause" label="Pause" onPress={() => session && api(`/hi/ar/sessions/${session.id}/pause`, { method: "POST" })} testID="ar-pause" />
              <Ctrl icon="shield-check-outline" label="Safety" onPress={() => Alert.alert("Safety", cur?.safety_note || "Stop if anything feels unsafe. You can switch to written steps or contact a pro anytime.")} testID="ar-safety" />
              <Ctrl icon="close" label="Exit" onPress={() => router.back()} testID="ar-exit" />
            </View>

            {showText ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>All steps (text)</Text>
                {instructions.map((it, i) => (
                  <View key={it.id} style={styles.textRow}>
                    <Text style={[styles.textNum, i === idx && { color: colors.brandPrimary }]}>{i + 1}.</Text>
                    <Text style={styles.textInstr}>{it.instruction}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <Modal visible={finishOpen} transparent animationType="fade" onRequestClose={() => setFinishOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Finished the guided view</Text>
            <Text style={styles.note}>Completing AR doesn't automatically mark your task done. Only confirm if you actually completed the work.</Text>
            <Pressable testID="ar-finish-confirm" disabled={busy} style={styles.primaryBtn} onPress={() => finish(true)}><Text style={styles.primaryText}>I completed this — mark it done</Text></Pressable>
            <Pressable testID="ar-finish-nochange" disabled={busy} style={styles.outlineBtn} onPress={() => finish(false)}><Text style={styles.outlineText}>Just save the session</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Ctrl({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} style={styles.ctrl} onPress={onPress}>
      <MaterialCommunityIcons name={icon as any} size={20} color={colors.onSurfaceSecondary} />
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  statusCard: { flexDirection: "row", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  statusTitle: { fontFamily: font.bold, fontSize: type.base },
  reason: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 3, lineHeight: 18 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  actionWrap: { marginTop: spacing.sm },
  actionChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  aChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  aChipText: { fontFamily: font.medium, fontSize: type.xs, color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  visualsHint: { fontFamily: font.regular, fontSize: type.xs, color: colors.onSurfaceTertiary, marginTop: 6 },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.xs },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  primaryBtnSm: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  outlineBtnSm: { flex: 1, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginTop: spacing.sm },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  progressText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  stage: { alignItems: "center", justifyContent: "center", backgroundColor: "#0d0d0d", borderRadius: radius.md, paddingVertical: spacing["2xl"], marginBottom: spacing.md, gap: spacing.sm },
  overlayChip: { color: "#fff", fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  estTag: { backgroundColor: "#F2994A", borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  estText: { color: "#fff", fontFamily: font.bold, fontSize: 9, letterSpacing: 1 },
  safety: { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#EB575712", borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  safetyText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  controls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.md },
  ctrl: { alignItems: "center", gap: 3, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, width: "31%" },
  ctrlLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  textRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 5, borderBottomColor: colors.border, borderBottomWidth: 1 },
  textNum: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, width: 22 },
  textInstr: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  modalWrap: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
});
