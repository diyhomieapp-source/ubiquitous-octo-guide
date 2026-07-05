import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, Alert, Modal,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;
const origin = () => (typeof window !== "undefined" && window.location ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));

type Line = { label: string; amount_cents: number };
type Msg = { id: string; from_role: string; from_name: string; body: string; at: string };
type CR = { id: string; body: string; at: string; status: string };
type Invoice = { id: string; label: string; amount_cents: number; kind: string; status: string };
type Job = {
  id: string; title: string; description: string; status: string; pro_name: string; client_email: string;
  is_pro_side: boolean; proposal?: { line_items: Line[]; total_cents: number; note: string } | null;
  messages: Msg[]; change_requests: CR[]; review?: { rating: number; text: string } | null; invoices?: Invoice[];
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", proposal_sent: "Proposal sent", approved: "Approved",
  in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};
const STATUS_COLOR: Record<string, string> = {
  draft: colors.onSurfaceTertiary, proposal_sent: colors.info, approved: colors.brandPrimary,
  in_progress: colors.warning, completed: colors.success, cancelled: colors.error,
};

export default function JobDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [propOpen, setPropOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ label: "", amount_cents: 0 }]);
  const [propNote, setPropNote] = useState("");
  const [invOpen, setInvOpen] = useState(false);
  const [invLabel, setInvLabel] = useState("");
  const [invAmt, setInvAmt] = useState("");

  const load = useCallback(async () => {
    try { setJob(await api<Job>(`/pro/jobs/${id}`)); } catch (e: any) {
      if (e?.status === 403 || e?.status === 404) router.back();
    } finally { setLoading(false); }
  }, [id, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    if (!msg.trim()) return;
    const body = msg.trim(); setMsg("");
    try { await api(`/pro/jobs/${id}/message`, { method: "POST", body: { body } }); load(); } catch {}
  };

  const proAction = async (path: string, body?: any, method: string = "POST") => {
    Haptics.selectionAsync();
    try { await api(path, { method, body }); load(); } catch (e: any) { Alert.alert("Error", e?.message || "Try again."); }
  };

  const submitProposal = async () => {
    const items = lines.filter((l) => l.label.trim() && l.amount_cents > 0);
    if (items.length === 0) { Alert.alert("Add line items", "Add at least one item with an amount."); return; }
    try {
      await api(`/pro/jobs/${id}/proposal`, { method: "POST", body: { line_items: items, note: propNote.trim() } });
      setPropOpen(false); setLines([{ label: "", amount_cents: 0 }]); setPropNote(""); load();
    } catch (e: any) { Alert.alert("Error", e?.message || "Try again."); }
  };

  const createInvoice = async () => {
    const cents = Math.round(parseFloat(invAmt || "0") * 100);
    if (!invLabel.trim() || cents <= 0) { Alert.alert("Add details", "Enter a label and amount."); return; }
    try {
      await api(`/pro/jobs/${id}/invoices`, { method: "POST", body: { label: invLabel.trim(), amount_cents: cents, kind: "progress" } });
      setInvOpen(false); setInvLabel(""); setInvAmt(""); load();
    } catch (e: any) { Alert.alert("Error", e?.message || "Try again."); }
  };

  const payInvoice = async (invId: string) => {
    try {
      const { checkout_url } = await api<{ checkout_url: string }>(`/client/invoices/${invId}/pay`, { method: "POST", body: { origin_url: origin() } });
      if (Platform.OS === "web") window.open(checkout_url, "_blank"); else await WebBrowser.openBrowserAsync(checkout_url);
    } catch (e: any) { Alert.alert("Payment", e?.message || "Could not start payment."); }
  };

  const review = () => {
    Alert.prompt?.("Leave a review", "How was the work? (optional note)", (text) => {
      proAction(`/client/jobs/${id}/review`, { rating: 5, text: text || "" });
    });
    if (!Alert.prompt) proAction(`/client/jobs/${id}/review`, { rating: 5, text: "" });
  };

  const changeRequest = () => {
    Alert.prompt?.("Request a change", "Describe what you'd like adjusted.", (text) => {
      if (text?.trim()) proAction(`/client/jobs/${id}/change-request`, { body: text });
    });
  };

  if (loading || !job) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  const isPro = job.is_pro_side;
  const total = lines.reduce((s, l) => s + (l.amount_cents || 0), 0);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="job-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{job.title}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90 }}>
        <View style={styles.metaRow}>
          <View style={[styles.pill, { backgroundColor: (STATUS_COLOR[job.status] || colors.onSurfaceTertiary) + "22" }]}>
            <Text style={[styles.pillText, { color: STATUS_COLOR[job.status] || colors.onSurfaceTertiary }]}>{STATUS_LABEL[job.status] || job.status}</Text>
          </View>
          <Text style={styles.subtle}>{isPro ? job.client_email : job.pro_name}</Text>
        </View>
        {!!job.description && <Text style={styles.desc}>{job.description}</Text>}

        {/* Proposal */}
        <Text style={styles.section}>Proposal</Text>
        {job.proposal ? (
          <View style={styles.card}>
            {job.proposal.line_items.map((l, i) => (
              <View key={i} style={styles.lineRow}><Text style={styles.lineLabel}>{l.label}</Text><Text style={styles.lineAmt}>{money(l.amount_cents)}</Text></View>
            ))}
            <View style={[styles.lineRow, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalAmt}>{money(job.proposal.total_cents)}</Text></View>
            {!!job.proposal.note && <Text style={styles.note}>{job.proposal.note}</Text>}
            {!isPro && job.status === "proposal_sent" && (
              <View style={styles.actionRow}>
                <Pressable testID="job-approve" style={styles.primaryBtn} onPress={() => proAction(`/client/jobs/${id}/approve`)}>
                  <Text style={styles.primaryText}>APPROVE</Text>
                </Pressable>
                <Pressable testID="job-change-req" style={styles.outlineBtn} onPress={changeRequest}>
                  <Text style={styles.outlineText}>Request change</Text>
                </Pressable>
              </View>
            )}
            {isPro && (
              <Pressable testID="job-edit-proposal" style={styles.linkBtn} onPress={() => setPropOpen(true)}><Text style={styles.link}>Edit proposal</Text></Pressable>
            )}
          </View>
        ) : (
          isPro ? (
            <Pressable testID="job-create-proposal" style={styles.dashed} onPress={() => setPropOpen(true)}>
              <MaterialCommunityIcons name="file-plus-outline" size={22} color={colors.brandPrimary} />
              <Text style={styles.dashedText}>Create proposal</Text>
            </Pressable>
          ) : <Text style={styles.subtle}>No proposal yet — your pro is preparing one.</Text>
        )}

        {/* Pro status controls */}
        {isPro && job.proposal && (
          <View style={styles.statusBtns}>
            {job.status === "approved" && <Pressable testID="job-start" style={styles.statusBtn} onPress={() => proAction(`/pro/jobs/${id}/status?status=in_progress`)}><Text style={styles.statusBtnText}>Start work</Text></Pressable>}
            {job.status === "in_progress" && <Pressable testID="job-complete" style={styles.statusBtn} onPress={() => proAction(`/pro/jobs/${id}/status?status=completed`)}><Text style={styles.statusBtnText}>Mark completed</Text></Pressable>}
          </View>
        )}

        {/* Change requests */}
        {job.change_requests.length > 0 && (
          <>
            <Text style={styles.section}>Change requests</Text>
            {job.change_requests.map((c) => (
              <View key={c.id} style={styles.crCard}><MaterialCommunityIcons name="pencil-outline" size={15} color={colors.warning} /><Text style={styles.crText}>{c.body}</Text></View>
            ))}
          </>
        )}

        {/* Invoices */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Invoices</Text>
          {isPro && <Pressable testID="job-add-invoice" hitSlop={8} onPress={() => setInvOpen(true)}><MaterialCommunityIcons name="plus-circle" size={22} color={colors.brandPrimary} /></Pressable>}
        </View>
        {(job.invoices || []).length === 0 ? <Text style={styles.subtle}>No invoices yet.</Text> : (job.invoices || []).map((inv) => (
          <View key={inv.id} style={styles.invCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.invLabel}>{inv.label}</Text>
              <Text style={styles.invMeta}>{money(inv.amount_cents)} · {inv.status}</Text>
            </View>
            {isPro && inv.status === "draft" && <Pressable testID={`inv-send-${inv.id}`} style={styles.smallBtn} onPress={() => proAction(`/pro/invoices/${inv.id}/send`)}><Text style={styles.smallBtnText}>Send</Text></Pressable>}
            {!isPro && inv.status === "sent" && <Pressable testID={`inv-pay-${inv.id}`} style={[styles.smallBtn, styles.smallBtnPay]} onPress={() => payInvoice(inv.id)}><Text style={styles.smallBtnPayText}>Pay {money(inv.amount_cents)}</Text></Pressable>}
            {inv.status === "paid" && <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />}
          </View>
        ))}

        {/* Review */}
        {!isPro && job.status === "completed" && !job.review && (
          <Pressable testID="job-review" style={[styles.primaryBtn, { marginTop: spacing.lg }]} onPress={review}><Text style={styles.primaryText}>LEAVE A REVIEW</Text></Pressable>
        )}
        {job.review && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.reviewStars}>{"⭐".repeat(job.review.rating)}</Text>
            {!!job.review.text && <Text style={styles.note}>{job.review.text}</Text>}
          </View>
        )}

        {/* Messages */}
        <Text style={styles.section}>Messages</Text>
        {job.messages.length === 0 ? <Text style={styles.subtle}>No messages yet. Say hello 👋</Text> : job.messages.map((m) => {
          const mine = (m.from_role === "pro") === isPro;
          return (
            <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.bubbleName, mine && { color: colors.onBrandPrimary }]}>{m.from_name}</Text>
              <Text style={[styles.bubbleBody, mine && { color: colors.onBrandPrimary }]}>{m.body}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* message composer */}
      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput testID="job-msg-input" style={styles.msgInput} value={msg} onChangeText={setMsg} placeholder="Message…" placeholderTextColor={colors.onSurfaceTertiary} onSubmitEditing={send} returnKeyType="send" />
        <Pressable testID="job-msg-send" style={styles.sendBtn} onPress={send}><MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} /></Pressable>
      </View>

      {/* proposal modal */}
      <Modal visible={propOpen} transparent animationType="slide" onRequestClose={() => setPropOpen(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>Build proposal</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {lines.map((l, i) => (
                <View key={i} style={styles.lineEdit}>
                  <TextInput testID={`prop-label-${i}`} style={[styles.input, { flex: 2 }]} value={l.label} onChangeText={(t) => setLines((cur) => cur.map((x, j) => j === i ? { ...x, label: t } : x))} placeholder="Item (e.g. Materials)" placeholderTextColor={colors.onSurfaceTertiary} />
                  <TextInput testID={`prop-amt-${i}`} style={[styles.input, { flex: 1 }]} value={l.amount_cents ? String(l.amount_cents / 100) : ""} onChangeText={(t) => setLines((cur) => cur.map((x, j) => j === i ? { ...x, amount_cents: Math.round((parseFloat(t) || 0) * 100) } : x))} placeholder="$" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" />
                </View>
              ))}
              <Pressable testID="prop-add-line" style={styles.addLine} onPress={() => setLines((c) => [...c, { label: "", amount_cents: 0 }])}><MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} /><Text style={styles.link}>Add line</Text></Pressable>
              <TextInput testID="prop-note" style={[styles.input, { minHeight: 60, textAlignVertical: "top", marginTop: spacing.sm }]} value={propNote} onChangeText={setPropNote} placeholder="Note / timeline (optional)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            </ScrollView>
            <Text style={styles.propTotal}>Total: {money(total)}</Text>
            <View style={styles.sheetBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setPropOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="prop-send" style={styles.saveBtn} onPress={submitProposal}><Text style={styles.saveText}>SEND PROPOSAL</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* invoice modal */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>New invoice</Text>
            <TextInput testID="inv-label" style={styles.input} value={invLabel} onChangeText={setInvLabel} placeholder="Label (e.g. Deposit, Final)" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="inv-amount" style={[styles.input, { marginTop: spacing.sm }]} value={invAmt} onChangeText={setInvAmt} placeholder="Amount ($)" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" />
            <View style={[styles.sheetBtns, { marginTop: spacing.md }]}>
              <Pressable style={styles.cancelBtn} onPress={() => setInvOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="inv-create" style={styles.saveBtn} onPress={createInvoice}><Text style={styles.saveText}>ADD INVOICE</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 10 },
  subtle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xl },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  lineRow: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  lineAmt: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  totalRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 6, marginTop: 2 },
  totalLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  totalAmt: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 20 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  primaryBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  outlineBtn: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  outlineText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  linkBtn: { marginTop: spacing.sm },
  link: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  dashed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1.5, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: spacing.lg },
  dashedText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  statusBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  statusBtn: { flex: 1, backgroundColor: colors.onSurface, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  statusBtnText: { color: colors.surface, fontFamily: font.bold, fontSize: type.base },
  crCard: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.xs },
  crText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  invCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  invLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  invMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  smallBtn: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  smallBtnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  smallBtnPay: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  smallBtnPayText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  reviewStars: { fontSize: 18 },
  bubble: { maxWidth: "82%", borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  bubbleName: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10 },
  bubbleBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: 1 },
  composer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  msgInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  lineEdit: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  addLine: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: spacing.xs },
  propTotal: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginVertical: spacing.sm, textAlign: "right" },
  sheetBtns: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { flex: 2, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
});
