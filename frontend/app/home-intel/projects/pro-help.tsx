import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Switch } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const HELP_OPTIONS: { code: string; label: string; icon: any }[] = [
  { code: "quick_question", label: "Ask a Quick Question", icon: "chat-question-outline" },
  { code: "remote_review", label: "Request a Project Review", icon: "eye-check-outline" },
  { code: "estimate", label: "Get an Estimate", icon: "currency-usd" },
  { code: "onsite", label: "Find Local Help", icon: "map-marker-radius-outline" },
];
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under Review", professional_matched: "Professional Matched",
  professional_responded: "Professional Responded", appointment_requested: "Appointment Requested",
  appointment_confirmed: "Appointment Confirmed", completed: "Completed", cancelled: "Cancelled", expired: "Expired",
};
const SHARE_KEYS: { key: string; label: string }[] = [
  { key: "photos", label: "Photos" }, { key: "measurements", label: "Measurements" },
  { key: "products", label: "Product & material info" }, { key: "notes", label: "Project notes" },
  { key: "project_history", label: "Task history" },
];

export default function BringInAPro() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [requests, setRequests] = useState<any[]>([]);
  const [hybrid, setHybrid] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // create flow
  const [helpType, setHelpType] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<any>(null); // handoff in review stage
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ handoffs: any[] }>(`/hi/procollab/handoffs?project_id=${id}`);
      setRequests(d.handoffs);
      const h = await api(`/hi/procollab/projects/${id}/hybrid`);
      setHybrid(h);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createDraft = async () => {
    if (!helpType || !question.trim()) { Alert.alert("Almost there", "Pick a help type and describe what you need."); return; }
    setBusy(true);
    try {
      const res = await api(`/hi/procollab/handoffs`, {
        method: "POST", body: { project_id: id, help_type: helpType, user_question: question.trim() },
      });
      setDraft(res.handoff); setReview(res.sharing_review);
    } catch (e: any) { Alert.alert("Couldn't prepare", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const toggleShare = async (key: string, value: boolean) => {
    if (!draft) return;
    try {
      const res = await api(`/hi/procollab/handoffs/${draft.id}/sharing`, { method: "PUT", body: { [key]: value } });
      setReview(res.sharing_review);
    } catch {}
  };

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>(`/hi/procollab/handoffs/${draft.id}/submit`, { method: "POST", body: {} });
      Alert.alert("Request sent", res.message);
      setDraft(null); setReview(null); setHelpType(null); setQuestion("");
      load();
    } catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const decide = async (hid: string, decision: "accept" | "reject") => {
    try {
      const res = await api<{ message?: string }>(`/hi/procollab/handoffs/${hid}/response/${decision}`, { method: "POST", body: {} });
      if (res.message) Alert.alert("Saved", res.message);
      load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
  };

  const cancelReq = (hid: string) => {
    Alert.alert("Cancel this request?", "", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel request", style: "destructive", onPress: async () => { try { await api(`/hi/procollab/handoffs/${hid}/cancel`, { method: "POST", body: {} }); load(); } catch {} } },
    ]);
  };

  const setOwnership = async (sid: string, ownership: string) => {
    try { await api(`/hi/procollab/projects/${id}/steps/${sid}/ownership`, { method: "POST", body: { ownership } }); load(); } catch {}
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Bring in a Pro" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Bring in a Pro" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.homie}>DIY does not mean do it alone. Homie will make sure they have the project details they need.</Text>

        {!draft ? (
          <>
            <Text style={styles.section}>What do you need?</Text>
            {HELP_OPTIONS.map((h) => (
              <Pressable key={h.code} testID={`pro-help-${h.code}`}
                style={[styles.helpBtn, helpType === h.code && styles.helpActive]}
                onPress={() => setHelpType(h.code)}>
                <MaterialCommunityIcons name={h.icon} size={20} color={helpType === h.code ? colors.brandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.helpText, helpType === h.code && { color: colors.brandPrimary }]}>{h.label}</Text>
              </Pressable>
            ))}
            {helpType && (
              <>
                <TextInput testID="pro-question" style={styles.input} placeholder="What's going on? Describe your question or the situation…"
                  placeholderTextColor={colors.onSurfaceTertiary} multiline value={question} onChangeText={setQuestion} />
                <Pressable testID="pro-prepare" style={styles.primaryBtn} disabled={busy} onPress={createDraft}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Prepare Handoff Package</Text>}
                </Pressable>
              </>
            )}
          </>
        ) : (
          <View style={styles.reviewCard}>
            <Text style={styles.section}>Review What You&apos;re Sharing</Text>
            <Text style={styles.reviewSub}>Only the minimum needed for this review is shared by default.</Text>
            {SHARE_KEYS.map((s) => (
              <View key={s.key} style={styles.shareRow}>
                <Text style={styles.shareLabel}>{s.label}</Text>
                <Switch testID={`pro-share-${s.key}`} value={!!review?.permissions?.[s.key]}
                  onValueChange={(v) => toggleShare(s.key, v)} trackColor={{ true: colors.brandPrimary }} />
              </View>
            ))}
            <Text style={styles.notShared}>Never shared: {(review?.not_included || []).slice(-4).join(", ")}</Text>
            <View style={styles.rowBtns}>
              <Pressable style={styles.outlineBtn} onPress={() => { setDraft(null); setReview(null); }}><Text style={styles.outlineText}>Back</Text></Pressable>
              <Pressable testID="pro-send" style={styles.primaryBtnFlex} disabled={busy} onPress={submit}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Send Request</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {/* requests + statuses */}
        {requests.length > 0 && <Text style={styles.section}>Your requests</Text>}
        {requests.map((rq) => (
          <View key={rq.id} style={styles.reqCard}>
            <View style={styles.reqTop}>
              <Text style={styles.reqType}>{HELP_OPTIONS.find((h) => h.code === rq.help_type)?.label || rq.help_type}</Text>
              <Text style={[styles.reqStatus, rq.status === "professional_responded" && { color: colors.success }]}>{STATUS_LABEL[rq.status] || rq.status}</Text>
            </View>
            <Text style={styles.reqQuestion}>{rq.user_question}</Text>
            {rq.response && (
              <View style={styles.responseBox}>
                <Text style={styles.respHead}>Professional Review</Text>
                <Text style={styles.respProvider}>
                  Provided by: {rq.response.provider_name}{rq.response.trade ? ` · ${rq.response.trade}` : ""}
                  {rq.response.credentials_verified ? " · Verified" : ""}
                </Text>
                <Text style={styles.respMsg}>{rq.response.message}</Text>
                {!rq.recommendation_decision ? (
                  <View style={styles.rowBtns}>
                    <Pressable testID={`pro-accept-${rq.id}`} style={styles.acceptBtn} onPress={() => decide(rq.id, "accept")}><Text style={styles.acceptText}>Apply to Project</Text></Pressable>
                    <Pressable testID={`pro-reject-${rq.id}`} style={styles.outlineBtn} onPress={() => decide(rq.id, "reject")}><Text style={styles.outlineText}>Not Now</Text></Pressable>
                  </View>
                ) : (
                  <Text style={styles.decisionText}>{rq.recommendation_decision === "accepted" ? "Saved to your project history." : "You chose not to apply this."}</Text>
                )}
              </View>
            )}
            {!["completed", "cancelled", "expired"].includes(rq.status) && !rq.response && (
              <Pressable testID={`pro-cancel-${rq.id}`} onPress={() => cancelReq(rq.id)}><Text style={styles.cancelLink}>Cancel request</Text></Pressable>
            )}
          </View>
        ))}

        {/* hybrid DIY / professional plan */}
        {hybrid && hybrid.diy_tasks.length + hybrid.professional_tasks.length > 0 && (
          <>
            <Text style={styles.section}>Who does what?</Text>
            <Text style={styles.reviewSub}>Mark steps for a professional — you can keep going on the safe DIY work while pro work is pending.</Text>
            {hybrid.professional_work_pending && (
              <View style={styles.pendingBanner}>
                <MaterialCommunityIcons name="account-hard-hat" size={16} color={colors.warning} />
                <Text style={styles.pendingText}>Professional work needed — DIY tasks can continue.</Text>
              </View>
            )}
            {[...hybrid.professional_tasks, ...hybrid.diy_tasks].map((s: any) => (
              <View key={s.id} style={styles.stepRow}>
                <Text style={[styles.stepText, (s.status === "completed" || s.status === "skipped") && styles.strike]} numberOfLines={2}>{s.instruction}</Text>
                <Pressable testID={`pro-own-${s.id}`}
                  style={[styles.ownChip, s.ownership === "professional" ? styles.ownPro : styles.ownDiy]}
                  onPress={() => setOwnership(s.id, s.ownership === "professional" ? "diy" : "professional")}>
                  <Text style={[styles.ownChipText, { color: s.ownership === "professional" ? colors.warning : colors.success }]}>
                    {s.ownership === "professional" ? "Pro" : "DIY"}
                  </Text>
                </Pressable>
              </View>
            ))}
            {hybrid.next_diy_task && <Text style={styles.nextDiy}>Your next DIY task: {hybrid.next_diy_task.instruction}</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  homie: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  helpBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, backgroundColor: colors.surfaceSecondary },
  helpActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  helpText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 80, textAlignVertical: "top", marginTop: spacing.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  primaryBtnFlex: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  reviewCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  reviewSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.sm },
  shareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  shareLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  notShared: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  rowBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  outlineBtn: { flex: 1, alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  outlineText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  reqCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  reqTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reqType: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  reqStatus: { color: colors.info, fontFamily: font.medium, fontSize: type.sm },
  reqQuestion: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  responseBox: { borderColor: colors.success + "66", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: 2 },
  respHead: { color: colors.success, fontFamily: font.bold, fontSize: type.sm, textTransform: "uppercase" },
  respProvider: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  respMsg: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: 2 },
  acceptBtn: { flex: 1, alignItems: "center", backgroundColor: colors.success + "22", borderColor: colors.success, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  acceptText: { color: colors.success, fontFamily: font.bold, fontSize: type.base },
  decisionText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  cancelLink: { color: colors.error, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
  pendingBanner: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.warning + "18", borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  pendingText: { color: colors.warning, fontFamily: font.medium, fontSize: type.sm, flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderBottomColor: colors.border, borderBottomWidth: 1 },
  stepText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, flex: 1 },
  strike: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  ownChip: { borderRadius: radius.pill, borderWidth: 1, paddingVertical: 4, paddingHorizontal: spacing.md },
  ownPro: { borderColor: colors.warning, backgroundColor: colors.warning + "18" },
  ownDiy: { borderColor: colors.success, backgroundColor: colors.success + "14" },
  ownChipText: { fontFamily: font.bold, fontSize: type.sm },
  nextDiy: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
});
