import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";

const ASSIST_OPTIONS: { key: string; label: string; desc: string; icon: string }[] = [
  { key: "quick_question", label: "Quick Question", desc: "A professional answers one focused question", icon: "chat-question-outline" },
  { key: "remote_review", label: "Remote Review", desc: "A pro reviews your photos, scans & plan", icon: "file-eye-outline" },
  { key: "live_video", label: "Live Video Help", desc: "Connect with a pro over video", icon: "video-outline" },
  { key: "design_review", label: "Design Review", desc: "Architect/designer/engineer reviews the plan", icon: "pencil-ruler" },
  { key: "get_quotes", label: "Get Quotes", desc: "Structured request sent to local pros", icon: "clipboard-text-outline" },
  { key: "hire_pro", label: "Hire a Pro", desc: "Request in-person service", icon: "account-hard-hat" },
];

export function BringInProModal({ visible, onClose, sessionId, procedureId }: {
  visible: boolean; onClose: () => void; sessionId?: string; procedureId?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"form" | "preview" | "done">("form");
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState("");
  const [brief, setBrief] = useState<any>(null);
  const [assistType, setAssistType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<any>(null);

  const reset = () => { setPhase("form"); setQuestion(""); setBudget(""); setBrief(null); setAssistType(null); setRequest(null); };
  const close = () => { reset(); onClose(); };

  const generateBrief = async () => {
    setBusy(true);
    try {
      const res = await api<any>("/hi/proconnect/briefs", {
        method: "POST",
        body: { session_id: sessionId, procedure_id: procedureId, question: question.trim() || null, budget_range: budget.trim() || null },
      });
      setBrief(res.brief);
      setPhase("preview");
    } catch {} finally { setBusy(false); }
  };

  const submit = async () => {
    if (!brief || !assistType) return;
    setBusy(true);
    try {
      const res = await api<any>("/hi/proconnect/requests", {
        method: "POST", body: { brief_id: brief.id, assistance_type: assistType },
      });
      setRequest(res);
      setPhase("done");
    } catch {} finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handleRow}>
              <Text style={styles.title}>Bring in a Pro</Text>
              <Pressable testID="bip-close" onPress={close} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>

            {phase === "form" && (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.body}>I&apos;ll package everything — your progress, measurements, safety notes and home context — so you never have to explain the project from scratch.</Text>
                <Text style={styles.fieldLabel}>What do you need help with? (optional)</Text>
                <TextInput
                  testID="bip-question"
                  style={styles.input}
                  placeholder="e.g. The flange looks cracked — is it safe to set the new toilet?"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={question}
                  onChangeText={setQuestion}
                  multiline
                />
                <Text style={styles.fieldLabel}>Budget range (optional)</Text>
                <TextInput
                  testID="bip-budget"
                  style={[styles.input, { minHeight: 44 }]}
                  placeholder="e.g. $100–$300"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={budget}
                  onChangeText={setBudget}
                />
                <Pressable testID="bip-generate" style={styles.primaryBtn} disabled={busy} onPress={generateBrief}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Generate Project Brief</Text>}
                </Pressable>
              </ScrollView>
            )}

            {phase === "preview" && brief && (
              <ScrollView>
                <View style={styles.briefCard}>
                  <Text style={styles.briefTitle}>{brief.project_name}</Text>
                  {brief.current_task ? <Text style={styles.briefLine}>Current task: {brief.current_task}</Text> : null}
                  {brief.user_question ? <Text style={styles.briefLine}>Question: {brief.user_question}</Text> : null}
                  <Text style={styles.briefLine}>Completed: {brief.steps_completed?.length || 0} steps{brief.steps_completed?.length ? ` — ${brief.steps_completed.slice(0, 3).join("; ")}${brief.steps_completed.length > 3 ? "…" : ""}` : ""}</Text>
                  <Text style={styles.briefLine}>Remaining: {brief.steps_remaining?.length || 0} steps</Text>
                  {(brief.identified_risks || []).length > 0 && <Text style={[styles.briefLine, { color: colors.warning }]}>Risks flagged: {brief.identified_risks.length}</Text>}
                  {(brief.materials_tools || []).length > 0 && <Text style={styles.briefLine}>Tools/materials: {brief.materials_tools.slice(0, 5).map((t: string) => t.replace(/_/g, " ")).join(", ")}</Text>}
                  {brief.home_context?.nickname ? <Text style={styles.briefLine}>Home: {brief.home_context.nickname}</Text> : null}
                  {brief.budget_range ? <Text style={styles.briefLine}>Budget: {brief.budget_range}</Text> : null}
                </View>
                <Text style={styles.fieldLabel}>How would you like help?</Text>
                {ASSIST_OPTIONS.map((o) => (
                  <Pressable key={o.key} testID={`bip-type-${o.key}`} style={[styles.assistRow, assistType === o.key && styles.assistRowActive]} onPress={() => setAssistType(o.key)}>
                    <MaterialCommunityIcons name={o.icon as any} size={20} color={assistType === o.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assistLabel}>{o.label}</Text>
                      <Text style={styles.assistDesc}>{o.desc}</Text>
                    </View>
                    <MaterialCommunityIcons name={assistType === o.key ? "radiobox-marked" : "radiobox-blank"} size={20} color={assistType === o.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  </Pressable>
                ))}
                <Pressable testID="bip-submit" style={[styles.primaryBtn, !assistType && { opacity: 0.5 }]} disabled={busy || !assistType} onPress={submit}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Send Request with Brief</Text>}
                </Pressable>
              </ScrollView>
            )}

            {phase === "done" && (
              <View style={{ alignItems: "center", paddingVertical: spacing.lg }}>
                <MaterialCommunityIcons name="check-circle-outline" size={44} color={colors.success} />
                <Text style={[styles.title, { marginTop: spacing.sm }]}>Request sent</Text>
                <Text style={[styles.body, { textAlign: "center" }]}>{request?.message}</Text>
                <Pressable testID="bip-status" style={styles.primaryBtn} onPress={() => { close(); router.push("/home-intel/guide/assist"); }}>
                  <Text style={styles.primaryText}>View Request Status</Text>
                </Pressable>
                <Pressable testID="bip-continue" style={styles.outlineBtn} onPress={close}>
                  <Text style={styles.outlineText}>Continue My Project</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "88%" },
  handleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { ...type.heading, color: colors.onSurface },
  body: { ...type.body, color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  fieldLabel: { ...type.button, fontSize: 13, color: colors.onSurface, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, ...type.body, minHeight: 72, textAlignVertical: "top" },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.lg, alignSelf: "stretch" },
  primaryText: { ...type.button, color: colors.onBrandPrimary },
  outlineBtn: { borderWidth: 1, borderColor: colors.surfaceTertiary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.sm, alignSelf: "stretch" },
  outlineText: { ...type.button, color: colors.onSurface },
  briefCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  briefTitle: { ...type.button, fontSize: 16, color: colors.onSurface, marginBottom: spacing.xs },
  briefLine: { ...type.caption, color: colors.onSurfaceSecondary, marginTop: 3 },
  assistRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: "transparent", minHeight: 56 },
  assistRowActive: { borderColor: colors.brandPrimary },
  assistLabel: { ...type.button, fontSize: 14, color: colors.onSurface },
  assistDesc: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
});
