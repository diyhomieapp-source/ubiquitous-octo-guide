import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Switch, Linking, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { FeedbackChips } from "@/src/components/FeedbackChips";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const player = createAudioPlayer();

const EMOTION_COLOR: Record<string, string> = { neutral: colors.brandPrimary, encouraging: "#27AE60", cautionary: "#F2994A", urgent: "#EB5757", celebratory: "#9B51E0" };
const COMMANDS: { key: string; label: string; icon: string }[] = [
  { key: "repeat", label: "Repeat", icon: "repeat" },
  { key: "next_step", label: "Next step", icon: "skip-next-outline" },
  { key: "previous_step", label: "Previous", icon: "skip-previous-outline" },
  { key: "show_tools", label: "Tools", icon: "toolbox-outline" },
  { key: "stuck", label: "I'm stuck", icon: "help-circle-outline" },
  { key: "pause", label: "Pause", icon: "pause-circle-outline" },
];

export default function VoiceRuntime() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const [session, setSession] = useState<any>(null);
  const [resp, setResp] = useState<any>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [large, setLarge] = useState(false);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [simplifying, setSimplifying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const confirmNext = useRef(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  const speak = useCallback(async (spokenText: string) => {
    if (mutedRef.current || !spokenText?.trim()) return;
    try {
      const r = await api<any>("/hi/voice/tts", { method: "POST", body: { text: spokenText } });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.replace(`${BASE}${r.url}`);
      player.seekTo(0);
      player.play();
      setSpeaking(true);
      setTimeout(() => setSpeaking(false), Math.min(30000, spokenText.length * 90));
    } catch { /* captions always remain */ }
  }, []);

  const startRecording = async () => {
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          perm = await requestRecordingPermissionsAsync();
        }
        if (!perm.granted) {
          Alert.alert("Microphone needed", "Talking to Homie hands-free needs the microphone. You can enable it in Settings — typing always works too.",
            Platform.OS === "web" ? undefined : [{ text: "Not now", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
          return;
        }
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      Alert.alert("Couldn't start the mic", "Voice input needs a device build or mic-enabled browser. You can type instead.");
    }
  };

  const stopAndTranscribe = async () => {
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording");
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        form.append("file", new (globalThis as any).File([blob], "speech.webm", { type: blob.type || "audio/webm" }));
      } else {
        form.append("file", { uri, name: "speech.m4a", type: "audio/m4a" } as any);
      }
      const token = await getToken();
      const res = await fetch(`${BASE}/api/hi/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error("Transcription failed");
      const data = await res.json();
      const transcript = (data.text || data.transcript || "").trim();
      if (!transcript) { Alert.alert("I didn't catch that", "Mind trying again, or type it?"); return; }
      if (session) {
        try { await api(`/hi/voice/sessions/${session.id}/speech`, { method: "POST", body: { transcript, transcript_confidence: 0.9 } }); } catch {}
      }
      setText(transcript);
      await ask(transcript);
    } catch (e: any) {
      Alert.alert("Couldn't transcribe", "Voice capture works best on a real device build — you can type your question instead.");
    } finally { setTranscribing(false); }
  };

  const simplify = async () => {
    if (!session || !resp) return;
    setSimplifying(true);
    try {
      const r = await api<any>(`/hi/voice/sessions/${session.id}/simplify`, { method: "POST", body: { text: resp.full_text || resp.spoken } });
      setResp({ ...resp, spoken: r.spoken || resp.spoken, full_text: r.full_text, simplified: true });
      speak(r.spoken || r.full_text);
    } catch (e: any) { Alert.alert("Couldn't simplify", e?.message || "Try again."); }
    finally { setSimplifying(false); }
  };

  const load = useCallback(async () => {
    try {
      const r = await api<any>("/hi/voice/sessions", { method: "POST", body: { interaction_mode: "mixed", project_id: projectId || null } });
      setSession(r.session);
    } catch (e: any) { Alert.alert("Couldn't start", e?.message || "Try again."); } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const ask = async (q?: string) => {
    const question = (q ?? text).trim();
    if (!question || !session) return;
    setBusy(true);
    try {
      const r = await api<any>(`/hi/voice/sessions/${session.id}/ask`, { method: "POST", body: { text: question } });
      setResp(r.response); setText("");
      if (!r.response?.emergency) speak(r.response?.spoken);
    } catch (e: any) { Alert.alert("Couldn't answer", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const command = async (cmd: string) => {
    if (!session) return;
    setBusy(true);
    try {
      const confirm = cmd === "next_step" && confirmNext.current;
      const r = await api<any>(`/hi/voice/sessions/${session.id}/handsfree`, { method: "POST", body: { command: cmd, confirm } });
      if (r.needs_confirmation) {
        confirmNext.current = true;
        Alert.alert("Confirm", r.spoken, [{ text: "Cancel", style: "cancel", onPress: () => (confirmNext.current = false) },
          { text: "Confirm", onPress: () => command("next_step") }]);
      } else {
        confirmNext.current = false;
        setResp({ emergency: false, spoken: r.spoken, full_text: r.spoken, action_cards: (r.tools || []).map((t: string) => ({ label: t })), emotion: "neutral", gesture: "explain" });
      }
    } catch (e: any) { Alert.alert("Command failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Homie Voice" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const emColor = resp ? (EMOTION_COLOR[resp.emotion] || colors.brandPrimary) : colors.brandPrimary;
  const ACTION_ROUTES: Record<string, string> = {
    whats_next: "/home-intel/projects", show_me: "/home-intel/guide", start_ar: "/home-intel/ar",
    scan_it: "/home-intel/twin/capture", rescan_target: "/home-intel/twin/capture",
    add_to_project: "/home-intel/projects", find_materials: "/home-intel/projects",
    mark_complete: "/home-intel/projects", ask_a_pro: "/pros", save_for_later: "/home-intel/projects",
  };
  const runActionChip = (c: any) => {
    if (c.action && ACTION_ROUTES[c.action]) router.push(ACTION_ROUTES[c.action] as any);
  };
  const fs = large ? 2 : 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Homie Voice" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={[styles.hint, { fontSize: type.sm + fs }]}>Hold your phone or set it down — tap the mic, speak, tap stop. Captions always shown. (Full voice quality needs a real device build.)</Text>

        {resp?.emergency ? (
          <View style={styles.emergencyCard}>
            <MaterialCommunityIcons name="alert-octagon" size={26} color="#fff" />
            <Text style={styles.emergencyText}>{resp.full_text}</Text>
          </View>
        ) : resp ? (
          <View style={[styles.respCard, { borderLeftColor: emColor }]}>
            <View style={styles.respHead}>
              <View style={[styles.emoChip, { backgroundColor: emColor + "22", borderColor: emColor }]}><Text style={[styles.emoText, { color: emColor }]}>{resp.emotion}</Text></View>
              {resp.confidence_level ? <View testID="voice-confidence-chip" style={styles.emoChip}><Text style={styles.emoText}>confidence: {resp.confidence_level}</Text></View> : null}
              {resp.safety_level && resp.safety_level !== "green" ? (
                <View testID="voice-safety-chip" style={[styles.emoChip, { borderColor: resp.safety_level === "red" ? colors.error : "#F2C94C" }]}>
                  <Text style={[styles.emoText, { color: resp.safety_level === "red" ? colors.error : "#F2C94C" }]}>safety: {resp.safety_level}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.spoken, { fontSize: type.lg + fs }]}>{resp.spoken}</Text>
            {resp.full_text && resp.full_text !== resp.spoken ? <Text style={[styles.caption, { fontSize: type.sm + fs }]}>{resp.full_text}</Text> : null}
            {resp.clarifying_question ? <Text style={[styles.clar, { fontSize: type.sm + fs }]}>❓ {resp.clarifying_question}</Text> : null}
            {resp.stop_condition ? <Text style={[styles.stop, { fontSize: type.sm + fs }]}>🛑 {resp.stop_condition}</Text> : null}
            {(resp.action_cards || []).map((c: any, i: number) => (
              <Pressable key={i} testID={`voice-action-${i}`} style={styles.actionCard} onPress={() => runActionChip(c)}>
                <Text style={styles.actionText}>{c.label}</Text>
                {c.action ? <MaterialCommunityIcons name="chevron-right" size={16} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
            <View style={styles.respActions}>
              <Pressable testID="voice-simplify" disabled={simplifying || resp.simplified} onPress={simplify} style={[styles.simplifyBtn, resp.simplified && { opacity: 0.5 }]}>
                {simplifying ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <><MaterialCommunityIcons name="lightbulb-outline" size={15} color={colors.brandPrimary} /><Text style={styles.simplifyText}>{resp.simplified ? "Simplified" : "Say it simpler"}</Text></>}
              </Pressable>
              <Pressable testID="voice-replay" onPress={() => speak(resp.spoken)} style={styles.simplifyBtn}>
                <MaterialCommunityIcons name={speaking ? "volume-high" : "volume-medium"} size={15} color={colors.brandPrimary} />
                <Text style={styles.simplifyText}>{speaking ? "Speaking…" : "Replay"}</Text>
              </Pressable>
            </View>
            <FeedbackChips contextType="homie_answer" contextId={session?.id} />
          </View>
        ) : (
          <Text style={styles.empty}>Ask Homie anything about your home or project.</Text>
        )}

        {/* Hands-free commands */}
        {projectId ? (
          <>
            <Text style={styles.section}>Hands-free commands</Text>
            <View style={styles.cmdWrap}>
              {COMMANDS.map((c) => (
                <Pressable key={c.key} testID={`voice-cmd-${c.key}`} disabled={busy} style={styles.cmdBtn} onPress={() => command(c.key)}>
                  <MaterialCommunityIcons name={c.icon as any} size={18} color={colors.brandPrimary} />
                  <Text style={styles.cmdText}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>High-risk or professional work never advances by voice alone — you&apos;ll always confirm.</Text>
          </>
        ) : null}

        {/* Accessibility */}
        <Text style={styles.section}>Accessibility</Text>
        <View style={styles.accRow}><Text style={styles.accLabel}>Larger text</Text><Switch testID="voice-large-text" value={large} onValueChange={setLarge} trackColor={{ true: colors.brandPrimary }} /></View>
        <View style={styles.accRow}><Text style={styles.accLabel}>Mute spoken replies</Text><Switch testID="voice-mute" value={muted} onValueChange={setMuted} trackColor={{ true: colors.brandPrimary }} /></View>
        <Text style={styles.hint}>Captions are always shown. DIYhomie is fully usable without voice or avatar.</Text>
      </ScrollView>

      {/* Ask bar */}
      <View style={styles.askBar}>
        <TextInput testID="voice-input" value={text} onChangeText={setText} placeholder="Ask Homie…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { fontSize: type.base + fs }]} onSubmitEditing={() => ask()} returnKeyType="send" />
        <Pressable
          testID="voice-mic"
          style={[styles.micBtn, recording && styles.micActive]}
          onPress={() => (recording ? stopAndTranscribe() : startRecording())}
        >
          {transcribing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
            <MaterialCommunityIcons name={recording ? "stop-circle" : "microphone-outline"} size={22} color={recording ? "#fff" : colors.onSurfaceTertiary} />
          )}
        </Pressable>
        <Pressable testID="voice-send" disabled={busy || !text.trim()} style={[styles.sendBtn, (busy || !text.trim()) && { opacity: 0.5 }]} onPress={() => ask()}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="send" size={20} color="#fff" />}</Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.lg, textAlign: "center" },
  emergencyCard: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: "#EB5757", borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.sm },
  emergencyText: { flex: 1, color: "#fff", fontFamily: font.bold, fontSize: type.base, lineHeight: 21 },
  respCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  respHead: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm },
  emoChip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  emoText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  spoken: { color: colors.onSurface, fontFamily: font.bold, lineHeight: 24 },
  caption: { color: colors.onSurfaceSecondary, fontFamily: font.regular, marginTop: spacing.sm, lineHeight: 20 },
  clar: { color: colors.info, fontFamily: font.medium, marginTop: spacing.sm },
  stop: { color: "#EB5757", fontFamily: font.bold, marginTop: spacing.sm },
  actionCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm, minHeight: 44 },
  actionText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  cmdWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cmdBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  cmdText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  accRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  accLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  askBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular },
  micBtn: { padding: spacing.sm, borderRadius: 20 },
  micActive: { backgroundColor: "#EB5757" },
  respActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  simplifyBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  simplifyText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
