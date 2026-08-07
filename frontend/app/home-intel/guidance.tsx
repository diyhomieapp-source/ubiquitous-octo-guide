import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

type Session = {
  id: string; recognized_asset_details: string; assumptions: string[]; confidence_level: string;
  safety_status: string; recommended_action: string; tools_required: string[]; safety_equipment: string[];
  steps: string[]; stop_conditions: string[]; source_evidence: string; has_source: boolean; needs_clarification?: boolean;
};

const SAFETY_COLOR: Record<string, string> = {
  "Safe to continue": colors.success, "Verify first": colors.warning, "Stop and contact a professional": colors.error,
};
const CONF_COLOR: Record<string, string> = { "Confirmed": colors.success, "Likely": colors.info, "Needs verification": colors.warning };

export default function GuidanceScreen() {
  const router = useRouter();
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [clarifyQ, setClarifyQ] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [blocked, setBlocked] = useState(false);
  const clarifications = useRef<{ question: string; answer: string }[]>([]);

  // outcome UI
  const [mode, setMode] = useState<"guide" | "complete" | "summary">("guide");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const generate = useCallback(async () => {
    setLoading(true); setClarifyQ(null);
    try {
      const r = await api<Session>(`/hi/issues/${issueId}/guidance`, { method: "POST", body: { clarifications: clarifications.current } });
      if (r.needs_clarification && (r as any).clarifying_question) { setClarifyQ((r as any).clarifying_question); }
      else { setSession(r); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setBlocked(true); }
      else { Alert.alert("Couldn't build guidance", (e as any)?.message || "Try again."); }
    } finally { setLoading(false); }
  }, [issueId]);

  const started = useRef(false);
  useFocusEffect(useCallback(() => { if (!started.current) { started.current = true; generate(); } }, [generate]));

  const submitAnswer = () => {
    if (!answer.trim()) return;
    clarifications.current = [...clarifications.current, { question: clarifyQ!, answer: answer.trim() }];
    setAnswer(""); generate();
  };

  const recordOutcome = async (outcome: string, extra?: any) => {
    if (!session) return;
    setBusy(true);
    try {
      await api(`/hi/guidance/${session.id}/outcome`, { method: "POST", body: { outcome, ...extra } });
      return true;
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); return false; }
    finally { setBusy(false); }
  };

  const completeSave = async () => {
    const ok = await recordOutcome("completed", { notes: notes.trim() || undefined, completion_photo_base64: photo || undefined });
    if (ok) { Alert.alert("Saved to your home history", "Nice work!"); router.replace("/home-intel"); }
  };
  const stuck = async () => {
    const ok = await recordOutcome("unresolved", { notes: "User was stuck." });
    if (ok) router.replace(`/home-intel/help${session ? "" : ""}`);
  };
  const escalate = async () => {
    const ok = await recordOutcome("escalated", { notes: "Escalated to a professional." });
    if (!ok) return;
    try { const s = await api(`/hi/issues/${issueId}/job-summary`); setSummary(s); setMode("summary"); } catch {}
  };

  const addPhoto = () => {
    Alert.alert("Completion photo", "Add a photo of the finished work", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the finished work."); if (b) setPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const copySummary = async () => {
    if (!summary) return;
    const a = summary.asset;
    const text = [
      "DIYhomie — Job Summary",
      a ? `Asset: ${a.name} (${a.category || "-"})${a.brand ? `, ${a.brand}` : ""}${a.model_number ? ` ${a.model_number}` : ""}` : "Asset: (none)",
      `Issue: ${summary.symptoms}`,
      `Risk level: ${summary.issue?.risk_level}`,
      summary.attempted_actions?.length ? `Attempted: ${summary.attempted_actions.join("; ")}` : "Attempted: none",
      summary.documents?.length ? `Documents on file: ${summary.documents.map((d: any) => d.document_type).join(", ")}` : "",
    ].filter(Boolean).join("\n");
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "Job summary copied — paste it to any pro.");
  };

  // ---- render states
  if (blocked) {
    return (
      <View style={styles.root}><ScreenHeader title="Guidance" />
        <View style={{ padding: spacing.lg }}>
          <View style={styles.blockCard}>
            <MaterialCommunityIcons name="alert-octagon" size={40} color={colors.onError} />
            <Text style={styles.blockTitle}>This is an emergency</Text>
            <Text style={styles.blockSub}>DIY guidance is disabled for safety. Please contact a professional or emergency services.</Text>
          </View>
          <Pressable testID="hi-block-pro" style={styles.primaryBtn} onPress={() => router.push("/pros")}><Text style={styles.primaryText}>Find a professional</Text></Pressable>
        </View>
      </View>
    );
  }

  if (loading) {
    return <View style={styles.root}><ScreenHeader title="Building guidance" />
      <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.loadingText}>Analyzing your issue safely…</Text></View>
    </View>;
  }

  if (clarifyQ) {
    return (
      <View style={styles.root}><ScreenHeader title="One quick question" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <View style={styles.qCard}><MaterialCommunityIcons name="help-circle-outline" size={24} color={colors.brandPrimary} /><Text style={styles.qText}>{clarifyQ}</Text></View>
            <TextInput testID="hi-clarify-input" style={styles.input} value={answer} onChangeText={setAnswer} placeholder="Type your answer…" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            <Pressable testID="hi-clarify-submit" style={styles.primaryBtn} onPress={submitAnswer}><Text style={styles.primaryText}>Continue</Text></Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  if (mode === "summary" && summary) {
    const a = summary.asset;
    return (
      <View style={styles.root}><ScreenHeader title="Job Summary" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          <Text style={styles.summaryLead}>Share this with a pro so they arrive prepared.</Text>
          <View style={styles.infoCard}>
            {a && <Row k="Asset" v={`${a.name}${a.brand ? ` · ${a.brand}` : ""}${a.model_number ? ` ${a.model_number}` : ""}`} />}
            <Row k="Issue" v={summary.symptoms} />
            <Row k="Risk" v={summary.issue?.risk_level || "-"} />
            <Row k="Attempted" v={summary.attempted_actions?.join("; ") || "None"} />
            <Row k="Documents" v={summary.documents?.length ? summary.documents.map((d: any) => d.document_type).join(", ") : "None"} />
          </View>
          <Pressable testID="hi-copy-summary" style={styles.primaryBtn} onPress={copySummary}>
            <MaterialCommunityIcons name="content-copy" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryText}>  Copy summary</Text>
          </Pressable>
          <Pressable testID="hi-summary-pro" style={styles.outlineBtn} onPress={() => router.push("/pros")}><Text style={styles.outlineText}>Find a professional</Text></Pressable>
          <Pressable testID="hi-summary-done" style={styles.outlineBtn} onPress={() => router.replace("/home-intel")}><Text style={styles.outlineText}>Done</Text></Pressable>
        </ScrollView>
      </View>
    );
  }

  if (mode === "complete") {
    return (
      <View style={styles.root}><ScreenHeader title="Mark complete" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={styles.q}>Nice! Add a note or photo (optional).</Text>
            <TextInput testID="hi-complete-notes" style={styles.input} value={notes} onChangeText={setNotes} placeholder="What did you do?" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            <Pressable testID="hi-complete-photo" style={styles.outlineBtn} onPress={addPhoto}>
              <MaterialCommunityIcons name="camera-outline" size={18} color={colors.brandPrimary} /><Text style={styles.outlineText}>  {photo ? "Photo added" : "Add completion photo"}</Text>
            </Pressable>
            {photo && <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.preview} contentFit="cover" />}
            <Pressable testID="hi-complete-save" style={[styles.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={completeSave}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save to home history</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  if (!session) return <View style={styles.root}><ScreenHeader title="Guidance" /><View style={styles.center}><Text style={styles.loadingText}>No guidance available.</Text></View></View>;

  const safety = session.safety_status;
  const safeColor = SAFETY_COLOR[safety] || colors.warning;
  const mustStop = safety === "Stop and contact a professional";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Guidance" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={[styles.safetyBanner, { backgroundColor: safeColor }]}>
          <MaterialCommunityIcons name={mustStop ? "hand-back-right" : safety === "Verify first" ? "alert" : "check-circle"} size={22} color={colors.onError} />
          <Text style={styles.safetyText}>{safety}</Text>
        </View>

        <View style={styles.confRow}>
          <View style={[styles.confBadge, { borderColor: CONF_COLOR[session.confidence_level] || colors.warning }]}>
            <Text style={[styles.confText, { color: CONF_COLOR[session.confidence_level] || colors.warning }]}>{session.confidence_level}</Text>
          </View>
          {!session.has_source && <Text style={styles.noSource}>No manual on file — general guidance only</Text>}
        </View>

        <Text style={styles.cardH}>Recommended next action</Text>
        <Text style={styles.body}>{session.recommended_action || "—"}</Text>

        {!!session.recognized_asset_details && (<><Text style={styles.cardH}>Why this applies</Text><Text style={styles.body}>{session.recognized_asset_details}</Text></>)}
        {session.assumptions?.length > 0 && (<><Text style={styles.cardH}>Assumptions</Text>{session.assumptions.map((a, i) => <Text key={i} style={styles.li}>• {a}</Text>)}</>)}

        {session.tools_required?.length > 0 && (<><Text style={styles.cardH}>Tools required</Text>{session.tools_required.map((t, i) => <Text key={i} style={styles.li}>• {t}</Text>)}</>)}
        {session.safety_equipment?.length > 0 && (<><Text style={styles.cardH}>Protective equipment</Text>{session.safety_equipment.map((t, i) => <Text key={i} style={styles.li}>• {t}</Text>)}</>)}

        {session.steps?.length > 0 && (<><Text style={styles.cardH}>Step-by-step</Text>{session.steps.map((s, i) => (
          <View key={i} style={styles.stepRow}><View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View><Text style={styles.stepText}>{s}</Text></View>
        ))}</>)}

        {session.stop_conditions?.length > 0 && (<><Text style={[styles.cardH, { color: colors.error }]}>Stop immediately if…</Text>{session.stop_conditions.map((s, i) => <Text key={i} style={styles.li}>• {s}</Text>)}</>)}

        {!!session.source_evidence && (
          <View style={styles.sourceCard}>
            <Text style={styles.sourceLabel}>📄 From your uploaded document</Text>
            <Text style={styles.sourceText}>{session.source_evidence}</Text>
          </View>
        )}

        <View style={{ height: spacing.lg }} />
        {!mustStop && (
          <Pressable testID="hi-complete" style={styles.primaryBtn} onPress={() => setMode("complete")}><Text style={styles.primaryText}>Complete Step</Text></Pressable>
        )}
        <Pressable testID="hi-stuck" style={styles.outlineBtn} onPress={stuck} disabled={busy}><Text style={styles.outlineText}>I&apos;m Stuck</Text></Pressable>
        <Pressable testID="hi-escalate" style={[styles.outlineBtn, { borderColor: colors.error }]} onPress={escalate} disabled={busy}>
          <Text style={[styles.outlineText, { color: colors.error }]}>Contact a Professional</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loadingText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.md },
  safetyBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, padding: spacing.md },
  safetyText: { color: colors.onError, fontFamily: font.bold, fontSize: type.lg },
  confRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  confBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  confText: { fontFamily: font.bold, fontSize: type.sm },
  noSource: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  cardH: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22 },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: 2 },
  stepRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  stepText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 22 },
  sourceCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.info + "66", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  sourceLabel: { color: colors.info, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  sourceText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, fontStyle: "italic" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  outlineText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 90, marginTop: spacing.md, marginBottom: spacing.md, textAlignVertical: "top" },
  q: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginBottom: spacing.md },
  qCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  qText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 22 },
  preview: { width: "100%", height: 160, borderRadius: radius.md, marginTop: spacing.md },
  blockCard: { backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.xl, alignItems: "center" },
  blockTitle: { color: colors.onError, fontFamily: font.display, fontSize: type["2xl"], marginTop: spacing.sm },
  blockSub: { color: colors.onError, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.sm, textAlign: "center", lineHeight: 22 },
  summaryLead: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.md },
  infoCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  kv: { paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  k: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  v: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginTop: 2 },
});
