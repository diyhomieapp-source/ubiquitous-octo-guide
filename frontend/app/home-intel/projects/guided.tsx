import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { ReportProblemModal } from "@/src/components/ReportProblemModal";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const player = createAudioPlayer();
const SAFETY_TONE: Record<string, string> = { GREEN: colors.success, YELLOW: "#F2C94C", ORANGE: "#F2994A", RED: colors.error };

const CONTROLS = [
  { key: "repeat", label: "Repeat", icon: "replay" },
  { key: "slow", label: "Slow Down", icon: "speedometer-slow" },
  { key: "why", label: "Why?", icon: "help-circle-outline" },
  { key: "tool", label: "Tool?", icon: "hammer-wrench" },
  { key: "whats_next", label: "What's Next", icon: "skip-next-outline" },
  { key: "help", label: "I Need Help", icon: "hand-wave-outline" },
];

export default function GuidedWorkMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [homieMsg, setHomieMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [completion, setCompletion] = useState<any>(null);
  const [micro, setMicro] = useState<any[] | null>(null);
  const [problemOpen, setProblemOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [checkpointDef, setCheckpointDef] = useState<any>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [checkpointDone, setCheckpointDone] = useState(false);
  const [acked, setAcked] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const assessStep = useCallback(async (stepObj: any) => {
    setAssessment(null); setCheckpointDef(null); setChecked([]); setCheckpointDone(false); setAcked(false);
    if (!stepObj) return;
    try {
      const res = await api<any>("/hi/safetysys/assessments", {
        method: "POST", body: { project_id: id, task_id: stepObj.id, task_text: stepObj.instruction_text },
      });
      setAssessment(res.assessment);
      if (res.checkpoint) setCheckpointDef(res.checkpoint);
      if (res.assessment?.acknowledgment_tier === "informational") setAcked(true);
    } catch { setAcked(true); }
  }, [id]);

  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  const speak = useCallback(async (text: string) => {
    if (muted || !text?.trim()) return;
    try {
      const r = await api<any>("/hi/voice/tts", { method: "POST", body: { text } });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.replace(`${BASE}${r.url}`);
      player.seekTo(0);
      player.play();
    } catch {}
  }, [muted]);

  const start = useCallback(async () => {
    try {
      const res = await api<any>("/hi/guided/sessions", { method: "POST", body: { project_id: id } });
      setPayload(res);
      const first = res.welcome_back || res.step?.voice_text;
      if (first) speak(first);
      assessStep(res.step);
    } catch { Alert.alert("Guided Mode", "Couldn't start guided mode. Generate a project plan first."); router.back(); }
    finally { setLoading(false); }
  }, [id, router, speak, assessStep]);
  useEffect(() => { start(); }, [start]);

  const sid = payload?.session?.id;
  const step = payload?.step;

  const sendEvent = async (event: string) => {
    if (!sid) return;
    setBusy(true);
    try {
      const res = await api<any>(`/hi/guided/sessions/${sid}/event`, { method: "POST", body: { event } });
      setHomieMsg(res.message || null);
      if (res.message) speak(res.message);
    } catch {} finally { setBusy(false); }
  };

  const loadMicro = async () => {
    if (!sid) return;
    setBusy(true);
    try { const r = await api<any>(`/hi/guided/sessions/${sid}/micro`, { method: "POST" }); setMicro(r.micro_steps || []); }
    catch {} finally { setBusy(false); }
  };

  const done = async (confirmed: boolean) => {
    if (!sid) return;
    setVerifying(false);
    setBusy(true);
    try {
      const res = await api<any>(`/hi/guided/sessions/${sid}/done`, { method: "POST", body: { confirmed } });
      if (res.advanced) {
        setCompletion(res.completion || null);
        setPayload(res);
        setMicro(null);
        setHomieMsg(null);
        assessStep(res.step);
        if (res.completion?.up_next) speak(`Nice work. Up next: ${res.completion.up_next}`);
        else if (res.work_state === "TASK_COMPLETE") speak("Nice work. Everything in this plan is done.");
      } else {
        setHomieMsg(res.message);
        speak(res.message);
      }
    } catch {} finally { setBusy(false); }
  };

  const pause = async () => {
    if (!sid) return;
    try {
      const r = await api<any>(`/hi/guided/sessions/${sid}/pause`, { method: "POST", body: {} });
      Alert.alert("Paused", `${r.message}${r.before_you_return ? `\n\nBefore you return: ${r.before_you_return}` : ""}`,
        [{ text: "OK", onPress: () => router.back() }]);
    } catch {}
  };

  const runVoiceCommand = (cmd: string) => {
    if (["repeat", "slow", "why", "tool", "whats_next", "help"].includes(cmd)) sendEvent(cmd);
    else if (cmd === "done") {
      if (safetyGated) { setHomieMsg("Before we finish this step, complete the safety check on screen — voice can't skip safety confirmations."); }
      else setVerifying(true);
    }
    else if (cmd === "pause") pause();
    else if (cmd === "continue") { setCompletion(null); setHomieMsg(null); }
    else if (cmd === "bring_in_pro") { api(`/hi/guided/sessions/${sid}/pro`, { method: "POST" }).catch(() => {}); router.push(`/home-intel/projects/${id}`); }
    else if (cmd === "back") setHomieMsg("Going back within a completed step isn't supported yet — use Repeat to review this one.");
  };

  const submitCheckpoint = async () => {
    if (!checkpointDef) return;
    setBusy(true);
    try {
      const res = await api<any>("/hi/safetysys/checkpoints", {
        method: "POST",
        body: { project_id: id, task_id: step?.id, checkpoint_type: checkpointDef.checkpoint_type, checked_items: checked },
      });
      setHomieMsg(res.message);
      if (res.unlocked) { setCheckpointDone(true); setAcked(true); }
    } catch {} finally { setBusy(false); }
  };

  const acknowledgeSafety = async () => {
    if (!assessment) { setAcked(true); return; }
    setBusy(true);
    try {
      const res = await api<any>(`/hi/safetysys/assessments/${assessment.id}/acknowledge`, { method: "POST", body: { confirmed: true } });
      if (res.ok) setAcked(true);
    } catch {} finally { setBusy(false); }
  };

  const safetyGated = (checkpointDef && !checkpointDone) || (assessment && !acked &&
    ["caution_confirmation", "critical_confirmation"].includes(assessment.acknowledgment_tier));

  const startRecording = async () => {
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Microphone needed", "Hands-free commands need the microphone. The buttons always work too.",
            Platform.OS === "web" ? undefined : [{ text: "Not now", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
          return;
        }
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch { Alert.alert("Mic unavailable", "Voice commands work best on a real device build — the buttons do everything too."); }
  };

  const stopAndCommand = async () => {
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording");
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        form.append("file", new (globalThis as any).File([blob], "speech.webm", { type: blob.type || "audio/webm" }));
      } else {
        form.append("file", { uri, name: "speech.m4a", type: "audio/m4a" } as any);
      }
      const token = await getToken();
      const res = await fetch(`${BASE}/api/hi/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await res.json();
      const text = (data.text || data.transcript || "").trim();
      if (!text) { setHomieMsg("I didn't catch that — try again or use the buttons."); return; }
      const r = await api<any>(`/hi/guided/sessions/${sid}/voice-command`, { method: "POST", body: { text } });
      if (!r.command) { setHomieMsg(r.message); speak(r.message); return; }
      setHomieMsg(`Heard: "${r.heard}"`);
      runVoiceCommand(r.command);
    } catch { setHomieMsg("Voice capture needs a device build — the buttons do everything too."); }
    finally { setTranscribing(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Guided Mode" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  if (payload?.work_state === "TASK_COMPLETE" || (!step && payload)) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Guided Mode" />
        <View style={styles.completeWrap}>
          <MaterialCommunityIcons name="trophy-outline" size={48} color={colors.success} />
          <Text style={styles.completeTitle}>Nice work.</Text>
          <Text style={styles.completeMsg}>{payload?.message || "Everything in this plan is done — let's verify and wrap up the project."}</Text>
          <Pressable testID="gw-finish" style={styles.primaryBtn} onPress={() => router.replace(`/home-intel/projects/${id}`)}>
            <Text style={styles.primaryText}>View Project</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const safety = step?.safety_level || {};
  const isStop = payload?.work_state === "SAFETY_STOP";

  return (
    <View style={styles.root}>
      <ScreenHeader title={payload?.project?.title || "Guided Mode"} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {payload?.welcome_back ? <Text style={styles.welcome}>{payload.welcome_back}</Text> : null}

        <View style={styles.headerRow}>
          <Text style={styles.stepCount}>STEP {step?.sequence_order} OF {step?.total_steps}</Text>
          <Pressable testID="gw-mute" onPress={() => setMuted((m) => !m)} hitSlop={8}>
            <MaterialCommunityIcons name={muted ? "volume-off" : "volume-high"} size={22} color={muted ? colors.onSurfaceTertiary : colors.brandPrimary} />
          </Pressable>
        </View>

        {/* safety status */}
        <View style={[styles.safetyStrip, { borderLeftColor: SAFETY_TONE[safety.color] || colors.success }]}>
          <Text style={[styles.safetyText, { color: SAFETY_TONE[safety.color] || colors.success }]}>
            {safety.color}: {safety.label}
          </Text>
        </View>

        {isStop ? (
          <View style={styles.stopCard}>
            <MaterialCommunityIcons name="hand-front-right" size={40} color={colors.error} />
            <Text style={styles.stopTitle}>Paused for safety</Text>
            <Text style={styles.stopMsg}>{safety.note || "This step needs verification before continuing."}</Text>
            <Pressable testID="gw-stop-pro" style={styles.primaryBtn} onPress={() => router.push(`/home-intel/projects/${id}`)}>
              <Text style={styles.primaryText}>Bring In a Pro</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* main instruction */}
            <View style={styles.instrCard}>
              <Text style={styles.instrText}>{step?.instruction_text}</Text>
              {step?.safety_card ? <Text style={styles.safetyCard}>⚠ {step.safety_card}</Text> : null}
              {(step?.required_tools || []).length > 0 && (
                <View style={styles.toolRow}>
                  <MaterialCommunityIcons name="hammer-wrench" size={16} color={colors.onSurfaceTertiary} />
                  <Text style={styles.toolText}>{step.required_tools.map((t: string) => t.replace(/_/g, " ")).join(" · ")}</Text>
                </View>
              )}
              {step?.estimated_time ? <Text style={styles.est}>~ {step.estimated_time}</Text> : null}
              <Pressable testID="gw-speak" style={styles.speakRow} onPress={() => speak(step?.voice_text)}>
                <MaterialCommunityIcons name="account-voice" size={18} color={colors.brandPrimary} />
                <Text style={styles.speakText}>Hear it from Homie</Text>
              </Pressable>
            </View>

            {/* completion transition */}
            {completion && (
              <View style={styles.completionBanner}>
                <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.completionTitle}>{completion.title} You completed: {completion.completed}</Text>
                  {completion.up_next ? <Text style={styles.completionNext}>Up next: {completion.up_next}{completion.estimated_time ? ` (~${completion.estimated_time})` : ""}</Text> : null}
                </View>
              </View>
            )}

            {homieMsg && (
              <View style={styles.homieMsg}>
                <MaterialCommunityIcons name="robot-happy-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.homieText}>{homieMsg}</Text>
              </View>
            )}

            {/* micro steps */}
            {micro ? (
              <View style={styles.microCard}>
                <Text style={styles.microTitle}>Tiny steps</Text>
                {micro.map((m: any, i: number) => (
                  <View key={i} style={styles.microRow}>
                    <Text style={styles.microNum}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.microAction}>{m.action}</Text>
                      {m.grip_or_position ? <Text style={styles.microGrip}>Hold: {m.grip_or_position}</Text> : null}
                      {m.caution ? <Text style={styles.microCaution}>⚠ {m.caution}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Pressable testID="gw-micro" style={styles.microBtn} disabled={busy} onPress={loadMicro}>
                <MaterialCommunityIcons name="format-list-numbered" size={16} color={colors.brandPrimary} />
                <Text style={styles.microBtnText}>Break this into tiny steps</Text>
              </Pressable>
            )}

            {/* controls */}
            <View style={styles.controlsGrid}>
              {CONTROLS.map((c) => (
                <Pressable key={c.key} testID={`gw-ctrl-${c.key}`} style={styles.ctrlBtn} disabled={busy} onPress={() => sendEvent(c.key)}>
                  <MaterialCommunityIcons name={c.icon as any} size={16} color={colors.brandPrimary} />
                  <Text style={styles.ctrlText}>{c.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Doc 56 — safety checkpoint / acknowledgment gate */}
            {checkpointDef && !checkpointDone && (
              <View style={styles.checkpointCard}>
                <Text style={styles.checkpointTitle}>🛡 {checkpointDef.title}</Text>
                {checkpointDef.items.map((it: string) => {
                  const on = checked.includes(it);
                  return (
                    <Pressable key={it} testID={`gw-cp-item-${checkpointDef.items.indexOf(it)}`} style={styles.checkRow}
                      onPress={() => setChecked((prev) => (on ? prev.filter((x) => x !== it) : [...prev, it]))}>
                      <MaterialCommunityIcons name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={on ? colors.success : colors.onSurfaceTertiary} />
                      <Text style={styles.checkText}>{it}</Text>
                    </Pressable>
                  );
                })}
                <Pressable testID="gw-cp-confirm" style={[styles.primaryBtn, checked.length < checkpointDef.items.length && { opacity: 0.5 }]}
                  disabled={busy || checked.length < checkpointDef.items.length} onPress={submitCheckpoint}>
                  <Text style={styles.primaryText}>Confirm Safety Checkpoint</Text>
                </Pressable>
              </View>
            )}
            {!checkpointDef && assessment && !acked && ["caution_confirmation", "critical_confirmation"].includes(assessment.acknowledgment_tier) && (
              <View style={styles.checkpointCard}>
                <Text style={styles.checkpointTitle}>🛡 Safety confirmation needed</Text>
                <Text style={styles.checkText}>{(assessment.reasons || [])[0] || step?.safety_card || "Confirm the safety conditions for this step are met."}</Text>
                {(assessment.ppe || []).length > 0 && <Text style={styles.ppeText}>PPE: {assessment.ppe.join(", ").replace(/_/g, " ")}</Text>}
                <Pressable testID="gw-ack" style={styles.primaryBtn} disabled={busy} onPress={acknowledgeSafety}>
                  <Text style={styles.primaryText}>I&apos;ve Confirmed This Is Safe</Text>
                </Pressable>
              </View>
            )}

            {/* verification */}
            {verifying ? (
              <View style={styles.verifyCard}>
                <Text style={styles.verifyQ}>{step?.verification_question}</Text>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Pressable testID="gw-verify-yes" style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]} disabled={busy} onPress={() => done(true)}>
                    {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Yes</Text>}
                  </Pressable>
                  <Pressable testID="gw-verify-no" style={[styles.outlineBtn, { flex: 1, marginTop: 0 }]} disabled={busy} onPress={() => done(false)}>
                    <Text style={styles.outlineText}>Not Yet</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable testID="gw-done" style={[styles.primaryBtn, safetyGated && { opacity: 0.5 }]} disabled={busy || !!safetyGated} onPress={() => setVerifying(true)}>
                <Text style={styles.primaryText}>{safetyGated ? "Complete Safety Check First" : "I'm Done With This Step"}</Text>
              </Pressable>
            )}

            {/* voice + bottom actions */}
            <View style={styles.bottomRow}>
              <Pressable
                testID="gw-mic"
                style={[styles.micBtn, recording && { backgroundColor: colors.error }]}
                onPress={recording ? stopAndCommand : startRecording}
                disabled={transcribing}
              >
                {transcribing ? <ActivityIndicator color={colors.onBrandPrimary} /> :
                  <MaterialCommunityIcons name={recording ? "stop" : "microphone-outline"} size={24} color={colors.onBrandPrimary} />}
              </Pressable>
              <Pressable testID="gw-problem" style={[styles.outlineBtn, { flex: 1, marginTop: 0, borderColor: colors.warning + "88" }]} onPress={() => setProblemOpen(true)}>
                <Text style={[styles.outlineText, { color: colors.warning }]}>Something Went Wrong</Text>
              </Pressable>
              <Pressable testID="gw-pause" style={[styles.outlineBtn, { marginTop: 0, paddingHorizontal: spacing.md }]} onPress={pause}>
                <MaterialCommunityIcons name="pause" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.voiceHint}>Try saying: &ldquo;repeat&rdquo; · &ldquo;slow it down&rdquo; · &ldquo;what tool do I need?&rdquo; · &ldquo;I&apos;m done&rdquo; · &ldquo;pause&rdquo;</Text>
          </>
        )}
      </ScrollView>

      <ReportProblemModal visible={problemOpen} onClose={() => setProblemOpen(false)} projectId={String(id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  welcome: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.md, lineHeight: 20 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepCount: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs, letterSpacing: 1 },
  safetyStrip: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginTop: spacing.sm },
  safetyText: { fontFamily: font.medium, fontSize: type.xs },
  stopCard: { alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.error + "66", borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, marginTop: spacing.lg },
  stopTitle: { color: colors.error, fontFamily: font.bold, fontSize: type.lg },
  stopMsg: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 22 },
  instrCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  instrText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, lineHeight: 28 },
  safetyCard: { color: "#F2C94C", fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm, lineHeight: 20 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
  toolText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize", flex: 1 },
  est: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.xs },
  speakRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md, minHeight: 44 },
  speakText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  completionBanner: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.success + "12", borderColor: colors.success + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  completionTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 20 },
  completionNext: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  homieMsg: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", borderLeftWidth: 3, borderLeftColor: colors.brandPrimary, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  homieText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, flex: 1, lineHeight: 20 },
  microBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.md, minHeight: 44, borderWidth: 1, borderColor: colors.brandPrimary + "55", borderRadius: radius.md },
  microBtnText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  microCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  microTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.sm },
  microRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  microNum: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, width: 18 },
  microAction: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  microGrip: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
  microCaution: { color: "#F2C94C", fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
  controlsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  ctrlBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, minHeight: 44, flexGrow: 1, justifyContent: "center" },
  ctrlText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.xs },
  verifyCard: { backgroundColor: colors.surfaceSecondary, borderColor: "#F2C94C55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  checkpointCard: { backgroundColor: colors.surfaceSecondary, borderColor: "#F2C94C88", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  checkpointTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  checkText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, flex: 1, lineHeight: 20 },
  ppeText: { color: "#F2C94C", fontFamily: font.medium, fontSize: type.xs, marginTop: spacing.xs, textTransform: "capitalize" },
  verifyQ: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md, lineHeight: 22 },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.md },
  outlineText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  micBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  voiceHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.sm, textAlign: "center", lineHeight: 16 },
  completeWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  completeTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl },
  completeMsg: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 22 },
});
