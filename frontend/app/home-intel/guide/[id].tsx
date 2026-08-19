import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

import { colors, spacing, radius, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { WatchAProDrawer } from "@/src/components/WatchAProDrawer";
import { BringInProModal } from "@/src/components/BringInProModal";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const player = createAudioPlayer();

const MODE_META: Record<string, { label: string; icon: string; tone: string }> = {
  SPATIAL_AR: { label: "Spatial AR", icon: "cube-scan", tone: "#2D9CDB" },
  SURFACE_PATH: { label: "Surface & Path", icon: "gesture-swipe-right", tone: "#27AE60" },
  FINE_MOTOR: { label: "Fine-Motor", icon: "hand-back-right-outline", tone: "#BB6BD9" },
  ASSEMBLY: { label: "Assembly", icon: "toy-brick-outline", tone: "#F2994A" },
  MEASUREMENT_LAYOUT: { label: "Measure & Layout", icon: "ruler-square", tone: "#F2C94C" },
};

const CONTROLS: { key: string; label: string; icon: string }[] = [
  { key: "show_again", label: "Show Me Again", icon: "replay" },
  { key: "slow_down", label: "Slow It Down", icon: "speedometer-slow" },
  { key: "another_angle", label: "Another Angle", icon: "rotate-3d-variant" },
  { key: "why", label: "Why This Step?", icon: "help-circle-outline" },
  { key: "what_tool", label: "What Tool?", icon: "hammer-wrench" },
  { key: "im_stuck", label: "I'm Stuck", icon: "hand-wave-outline" },
];

export default function GuidancePlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [proc, setProc] = useState<any>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [safetyBlock, setSafetyBlock] = useState<any>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [homieMsg, setHomieMsg] = useState<string | null>(null);
  const [visualOverride, setVisualOverride] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [muted, setMuted] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  const speak = useCallback(async (text: string) => {
    if (mutedRef.current || !text?.trim()) return;
    try {
      const r = await api<any>("/hi/voice/tts", { method: "POST", body: { text } });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.replace(`${BASE}${r.url}`);
      player.seekTo(0);
      player.play();
    } catch {}
  }, []);

  const start = useCallback(async () => {
    try {
      const res = await api<any>("/hi/guide/sessions", {
        method: "POST",
        body: { procedure_id: id, device: { platform: Platform.OS, supports_ar: Platform.OS !== "web" } },
      });
      setSession(res.session);
      setProc(res.procedure);
      setWelcome(res.welcome_back);
      setStepIdx(Math.min(res.session.current_step_index || 0, (res.procedure.steps || []).length - 1));
      setCompleted(res.session.status === "completed");
      if (res.welcome_back) speak(res.welcome_back);
    } catch (e) {
      const d = e instanceof ApiError ? e.detail : null;
      if (d?.state === "STOP_FOR_SAFETY") setSafetyBlock(d);
      else Alert.alert("Guidance", "Couldn't start this guide. Try again.");
    } finally { setLoading(false); }
  }, [id, speak]);
  useEffect(() => { start(); }, [start]);

  const steps = proc?.steps || [];
  const step = steps[stepIdx];
  const mode = MODE_META[step?.guidanceMode] || MODE_META.SPATIAL_AR;
  const visual = visualOverride || step?.visual;

  const sendEvent = async (event: string) => {
    if (!session || !step) return;
    setBusy(true);
    try {
      const res = await api<any>(`/hi/guide/sessions/${session.id}/steps/${step.stepId}/event`, { method: "POST", body: { event } });
      setHomieMsg(res.message || null);
      if (res.visual) setVisualOverride(res.visual);
      if (res.message) speak(res.message);
    } catch {} finally { setBusy(false); }
  };

  const verify = async (confirmed: boolean) => {
    if (!session || !step) return;
    setBusy(true);
    try {
      const res = await api<any>(`/hi/guide/sessions/${session.id}/steps/${step.stepId}/verify`, {
        method: "POST", body: { method: "user_confirmation", confirmed },
      });
      setHomieMsg(res.message || null);
      if (res.message) speak(res.message);
      if (res.stop_for_safety) { setSafetyBlock(res.stop_for_safety); return; }
      if (res.completed) { setCompleted(true); return; }
      if (res.advanced) {
        setNeedsReview(false);
        setVisualOverride(null);
        setStepIdx((i) => Math.min(i + 1, steps.length - 1));
        const nxt = steps[Math.min(stepIdx + 1, steps.length - 1)];
        if (nxt?.spoken) speak(nxt.spoken);
      } else if (!confirmed) {
        setNeedsReview(true);
      }
    } catch (e: any) { Alert.alert("Couldn't verify", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const pause = async () => {
    if (!session) return;
    try { const r = await api<any>(`/hi/guide/sessions/${session.id}/pause`, { method: "POST" }); Alert.alert("Paused", r.message, [{ text: "OK", onPress: () => router.back() }]); } catch {}
  };



  if (loading) return <View style={styles.root}><ScreenHeader title="Guided Steps" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  if (safetyBlock) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Guided Steps" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={[styles.card, { borderColor: colors.error + "66", borderWidth: 1 }]}>
            <MaterialCommunityIcons name="shield-alert-outline" size={28} color={colors.error} />
            <Text style={[styles.cardTitle, { color: colors.error, marginTop: spacing.sm }]}>Stopping for safety</Text>
            <Text style={styles.body}>{safetyBlock.message}</Text>
            {(safetyBlock.reasons || []).map((rn: string, i: number) => <Text key={i} style={styles.reason}>• {rn}</Text>)}
            <Pressable testID="guide-safety-pro" style={styles.primaryBtn} onPress={() => router.push("/pros")}><Text style={styles.primaryText}>Find a Professional</Text></Pressable>
            <Pressable style={styles.outlineBtn} onPress={() => router.back()}><Text style={styles.outlineText}>Back</Text></Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (completed) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={proc?.title || "Guided Steps"} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={[styles.card, { alignItems: "center" }]}>
            <MaterialCommunityIcons name="party-popper" size={40} color={colors.success} />
            <Text style={[styles.cardTitle, { marginTop: spacing.sm }]}>You did it!</Text>
            <Text style={[styles.body, { textAlign: "center" }]}>{proc?.title} is complete. Every step was confirmed by you — nothing was assumed.</Text>
            <Pressable testID="guide-done" style={styles.primaryBtn} onPress={() => router.back()}><Text style={styles.primaryText}>Done</Text></Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!step) return <View style={styles.root}><ScreenHeader title="Guided Steps" /><Text style={[styles.body, { padding: spacing.lg }]}>No steps found.</Text></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title={proc?.title || "Guided Steps"} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {welcome && (
          <View style={styles.welcomeCard}>
            <MaterialCommunityIcons name="human-greeting-variant" size={20} color={colors.brandPrimary} />
            <Text style={styles.welcomeText}>{welcome}</Text>
          </View>
        )}

        {/* progress */}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((stepIdx) / steps.length) * 100}%` }]} /></View>
          <Text style={styles.progressText}>Step {stepIdx + 1} of {steps.length}</Text>
          <Pressable testID="guide-mute" onPress={() => setMuted((m) => !m)} hitSlop={8}>
            <MaterialCommunityIcons name={muted ? "volume-off" : "volume-high"} size={22} color={muted ? colors.onSurfaceTertiary : colors.brandPrimary} />
          </Pressable>
        </View>

        {/* step card */}
        <View style={styles.card}>
          <View style={styles.modeRow}>
            <View style={[styles.badge, { borderColor: mode.tone + "66" }]}>
              <MaterialCommunityIcons name={mode.icon as any} size={14} color={mode.tone} />
              <Text style={[styles.badgeText, { color: mode.tone }]}>{mode.label}</Text>
            </View>
            {step.safety_note ? (
              <View style={[styles.badge, { borderColor: colors.warning + "88" }]}>
                <MaterialCommunityIcons name="alert-outline" size={14} color={colors.warning} />
                <Text style={[styles.badgeText, { color: colors.warning }]}>Safety note</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.stepTitle}>{step.task}</Text>

          {/* visual demonstration composer */}
          <View style={styles.visualBox}>
            <View style={styles.visualHead}>
              <MaterialCommunityIcons name={step.guidanceMode === "FINE_MOTOR" ? "hand-back-right-outline" : "cube-outline"} size={30} color={mode.tone} />
              <View style={{ flex: 1 }}>
                <Text style={styles.visualTemplate}>{String(visual?.template || "").replace(/_/g, " ")}</Text>
                <Text style={styles.visualMeta}>
                  {String(visual?.cameraView || "").replace(/_/g, "-").toLowerCase()} view · {String(visual?.speed || "NORMAL").toLowerCase()} speed
                  {visual?.showGhostHands ? " · ghost hands" : ""}{visual?.showArrows ? " · arrows" : ""}
                </Text>
              </View>
            </View>
            <View style={styles.chipRow}>
              {(visual?.visuals || []).map((v: string) => (
                <View key={v} style={styles.chip}><Text style={styles.chipText}>{v.replace(/_/g, " ")}</Text></View>
              ))}
            </View>
            <View style={styles.targetRow}>
              <MaterialCommunityIcons name="target" size={16} color={colors.warning} />
              <Text style={styles.targetText}>Target: {step.target?.label}</Text>
            </View>
            <Text style={styles.previewNote}>Live AR & hand-tracking render in the native build — this preview shows the exact instruction payload Homie sends to the AR layer.</Text>
          </View>

          {/* Homie voice */}
          <Pressable testID="guide-speak" style={styles.voiceRow} onPress={() => speak(step.spoken)}>
            <MaterialCommunityIcons name="account-voice" size={20} color={colors.brandPrimary} />
            <Text style={styles.voiceText}>{step.spoken}</Text>
            <MaterialCommunityIcons name="play-circle-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
          {step.tool ? (
            <View style={styles.toolRow}>
              <MaterialCommunityIcons name="hammer-wrench" size={16} color={colors.onSurfaceTertiary} />
              <Text style={styles.toolText}>Tool: {String(step.tool).replace(/_/g, " ")}</Text>
            </View>
          ) : null}
          {step.safety_note ? <Text style={styles.safetyNote}>⚠ {step.safety_note}</Text> : null}
        </View>

        {/* Homie responses */}
        {homieMsg && (
          <View style={styles.homieMsg}>
            <MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.homieMsgText}>{homieMsg}</Text>
          </View>
        )}

        {/* Watch a Pro (Doc 48) */}
        <Pressable testID="guide-watch-pro" style={styles.watchProBtn} onPress={() => setWatchOpen(true)}>
          <MaterialCommunityIcons name="play-box-outline" size={20} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.watchProTitle}>Watch a Pro</Text>
            <Text style={styles.watchProSub}>See how a professional handles this exact step</Text>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={20} color={colors.brandPrimary} />
        </Pressable>

        {/* controls */}
        <View style={styles.controlsGrid}>
          {CONTROLS.map((c) => (
            <Pressable key={c.key} testID={`guide-ctrl-${c.key}`} style={styles.ctrlBtn} disabled={busy} onPress={() => sendEvent(c.key)}>
              <MaterialCommunityIcons name={c.icon as any} size={18} color={colors.brandPrimary} />
              <Text style={styles.ctrlText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* verification */}
        <View style={styles.verifyCard}>
          <Text style={styles.verifyQ}>{step.verification?.question}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="guide-verify-yes" style={[styles.primaryBtn, { flex: 1 }]} disabled={busy} onPress={() => verify(true)}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Yes — Mark Complete</Text>}
            </Pressable>
            <Pressable testID="guide-verify-no" style={[styles.outlineBtn, { flex: 1 }]} disabled={busy} onPress={() => verify(false)}>
              <Text style={styles.outlineText}>Not Yet</Text>
            </Pressable>
          </View>
          {needsReview && <Text style={styles.reviewHint}>No rush — use &ldquo;Show Me Again&rdquo; or &ldquo;I&apos;m Stuck&rdquo; above, then confirm when ready.</Text>}
          <Text style={styles.verifyNote}>Nothing advances until you confirm — Homie never assumes a step is done.</Text>
        </View>

        {/* session controls */}
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable testID="guide-pause" style={[styles.outlineBtn, { flex: 1 }]} onPress={pause}>
            <MaterialCommunityIcons name="pause-circle-outline" size={18} color={colors.onSurface} />
            <Text style={styles.outlineText}>Pause & Save</Text>
          </Pressable>
          <Pressable testID="guide-pro" style={[styles.outlineBtn, { flex: 1, borderColor: colors.warning + "88" }]} onPress={() => setProOpen(true)}>
            <MaterialCommunityIcons name="account-hard-hat" size={18} color={colors.warning} />
            <Text style={[styles.outlineText, { color: colors.warning }]}>Bring In a Pro</Text>
          </Pressable>
        </View>
        <Pressable testID="guide-scope" style={styles.scopeLink} onPress={() => router.push(`/home-intel/guide/scope?procedure_id=${id}`)}>
          <MaterialCommunityIcons name="call-split" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.scopeLinkText}>Split this project: DIY vs Professional</Text>
        </Pressable>
      </ScrollView>

      <WatchAProDrawer visible={watchOpen} onClose={() => setWatchOpen(false)} procedureId={String(id)} stepId={step.stepId} />
      <BringInProModal visible={proOpen} onClose={() => setProOpen(false)} sessionId={session?.id} procedureId={String(id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { ...type.heading, color: colors.onSurface },
  body: { ...type.body, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  reason: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  welcomeCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.brandPrimary + "14", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  welcomeText: { ...type.body, color: colors.onSurface, flex: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  progressText: { ...type.caption, color: colors.onSurfaceTertiary },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm, flexWrap: "wrap" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { ...type.caption, fontSize: 11 },
  stepTitle: { ...type.heading, color: colors.onSurface, marginBottom: spacing.sm },
  visualBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceTertiary },
  visualHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  visualTemplate: { ...type.button, color: colors.onSurface, textTransform: "capitalize" },
  visualMeta: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  chip: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  chipText: { ...type.caption, fontSize: 11, color: colors.onSurfaceSecondary },
  targetRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  targetText: { ...type.caption, color: colors.warning },
  previewNote: { ...type.caption, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: spacing.sm, fontStyle: "italic" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.brandPrimary + "10", borderRadius: radius.md, padding: spacing.md, minHeight: 44 },
  voiceText: { ...type.body, color: colors.onSurface, flex: 1 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  toolText: { ...type.caption, color: colors.onSurfaceTertiary, textTransform: "capitalize" },
  safetyNote: { ...type.caption, color: colors.warning, marginTop: spacing.sm },
  homieMsg: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderLeftWidth: 3, borderLeftColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  homieMsgText: { ...type.body, color: colors.onSurfaceSecondary, flex: 1 },
  controlsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  ctrlBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, flexGrow: 1, justifyContent: "center" },
  ctrlText: { ...type.caption, color: colors.onSurface },
  verifyCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.warning + "44" },
  verifyQ: { ...type.button, fontSize: 15, color: colors.onSurface, marginBottom: spacing.md },
  reviewHint: { ...type.caption, color: colors.warning, marginTop: spacing.sm },
  verifyNote: { ...type.caption, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: spacing.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.sm },
  primaryText: { ...type.button, color: colors.onBrandPrimary },
  outlineBtn: { flexDirection: "row", gap: spacing.xs, borderWidth: 1, borderColor: colors.surfaceTertiary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.sm },
  outlineText: { ...type.button, color: colors.onSurface },
  watchProBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, minHeight: 56 },
  watchProTitle: { ...type.button, fontSize: 14, color: colors.brandPrimary },
  watchProSub: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
  scopeLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.md, minHeight: 44 },
  scopeLinkText: { ...type.caption, color: colors.onSurfaceTertiary, textDecorationLine: "underline" },
});
