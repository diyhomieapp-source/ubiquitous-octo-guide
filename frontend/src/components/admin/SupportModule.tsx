import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const PRIO_COLOR: Record<string, string> = { critical: "#FF3D00", high: "#FF6A00", normal: "#29B6F6", low: "#A0A0A5" };

export function SupportModule() {
  const [tab, setTab] = useState<"queue" | "kb">("queue");
  const [dash, setDash] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [kb, setKb] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const [reply, setReply] = useState("");
  const [kbTitle, setKbTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t, k] = await Promise.all([
        api<any>("/hi/admin/help/dashboard"), api<any>("/hi/admin/help/tickets"), api<any>("/hi/admin/help/kb"),
      ]);
      setDash(d); setTickets(t.tickets || []); setKb(k.articles || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openTicket = async (tid: string) => {
    try { setOpen(await api<any>(`/hi/admin/help/tickets/${tid}`)); } catch (e: any) { Alert.alert("Error", e?.message || "Try again."); }
  };
  const doReply = async () => {
    if (!reply.trim() || !open) return;
    setBusy(true);
    try { await api(`/hi/admin/help/tickets/${open.ticket.id}/reply`, { method: "POST", body: { body: reply.trim() } }); setReply(""); await openTicket(open.ticket.id); await load(); }
    catch (e: any) { Alert.alert("Couldn't reply", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const resolve = async () => {
    if (!open) return;
    setBusy(true);
    try { await api(`/hi/admin/help/tickets/${open.ticket.id}/resolve`, { method: "POST", body: { resolution_type: "human_resolved", summary: "Resolved by support." } }); setOpen(null); await load(); }
    catch (e: any) { Alert.alert("Couldn't resolve", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const setPrio = async (p: string) => {
    if (!open) return;
    setBusy(true);
    try { await api(`/hi/admin/help/tickets/${open.ticket.id}`, { method: "PUT", body: { priority: p } }); await openTicket(open.ticket.id); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const addKb = async () => {
    if (!kbTitle.trim()) return;
    setBusy(true);
    try { await api("/hi/admin/help/kb", { method: "POST", body: { title: kbTitle.trim(), category: "other", content: "Draft article.", status: "draft" } }); setKbTitle(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const publishKb = async (aid: string) => {
    setBusy(true);
    try { await api(`/hi/admin/help/kb/${aid}`, { method: "PUT", body: { status: "published" } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't publish", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  if (open) {
    const t = open.ticket;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
        <Pressable testID="sup-close" style={styles.backBtn} onPress={() => setOpen(null)}><MaterialCommunityIcons name="arrow-left" size={18} color={colors.brandPrimary} /><Text style={styles.backText}>Back to queue</Text></Pressable>
        <Text style={styles.h1}>{t.subject}</Text>
        <Text style={styles.rMeta}>{t.category?.replace("_", " ")} · {t.status} · <Text style={{ color: PRIO_COLOR[t.priority] }}>{t.priority}</Text></Text>
        {t.context ? <Text style={styles.ctx}>Context: {Object.entries(t.context).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}</Text> : null}
        <View style={styles.prioRow}>{["critical", "high", "normal", "low"].map((p) => <Pressable key={p} testID={`sup-prio-${p}`} style={[styles.prioBtn, { borderColor: PRIO_COLOR[p] }]} onPress={() => setPrio(p)}><Text style={[styles.prioBtnText, { color: PRIO_COLOR[p] }]}>{p}</Text></Pressable>)}</View>
        {(open.messages || []).map((m: any) => (
          <View key={m.id} style={[styles.msg, m.sender_type === "internal_note" && styles.note]}>
            <Text style={styles.sender}>{m.sender_type}</Text>
            <Text style={styles.msgBody}>{m.body}</Text>
          </View>
        ))}
        <TextInput testID="sup-reply" value={reply} onChangeText={setReply} placeholder="Reply to user…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
        <View style={styles.actRow}>
          <Pressable testID="sup-send" disabled={busy} style={styles.addBtn} onPress={doReply}><Text style={styles.addBtnText}>Send reply</Text></Pressable>
          <Pressable testID="sup-resolve" disabled={busy} style={[styles.addBtn, { backgroundColor: colors.success }]} onPress={resolve}><Text style={styles.addBtnText}>Resolve</Text></Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}><Text style={styles.h1}>Support</Text><Pressable testID="sup-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable></View>
      <View style={styles.statRow}>
        <Stat label="Open" value={dash.open} />
        <Stat label="Escalated" value={dash.escalated_open} accent={dash.escalated_open > 0} />
        <Stat label="AI resolved" value={dash.ai_resolved} />
        <Stat label="KB" value={dash.kb_published} />
      </View>
      <View style={styles.tabs}>{(["queue", "kb"] as const).map((t) => <Pressable key={t} testID={`sup-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}><Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text></Pressable>)}</View>

      {tab === "queue" && (tickets.length === 0 ? <Text style={styles.note2}>No tickets yet.</Text> : tickets.map((t) => (
        <Pressable key={t.id} testID={`sup-ticket-${t.id}`} style={styles.card} onPress={() => openTicket(t.id)}>
          <View style={styles.labelRow}><Text style={styles.rTitle} numberOfLines={1}>{t.subject}</Text><View style={[styles.tag, { borderColor: PRIO_COLOR[t.priority] }]}><Text style={[styles.tagText, { color: PRIO_COLOR[t.priority] }]}>{t.priority}</Text></View></View>
          <Text style={styles.rMeta}>{t.category?.replace("_", " ")} · {t.status?.replace("_", " ")}</Text>
        </Pressable>
      )))}

      {tab === "kb" && (
        <>
          <View style={styles.addRow}>
            <TextInput testID="sup-kb-title" value={kbTitle} onChangeText={setKbTitle} placeholder="New article title" placeholderTextColor={colors.onSurfaceTertiary} style={styles.inputFlex} />
            <Pressable testID="sup-kb-add" disabled={busy} style={styles.addBtn} onPress={addKb}><Text style={styles.addBtnText}>Add</Text></Pressable>
          </View>
          {kb.map((a) => (
            <View key={a.id} style={styles.card}>
              <View style={styles.labelRow}><Text style={styles.rTitle} numberOfLines={1}>{a.title}</Text><View style={[styles.tag, { borderColor: a.status === "published" || a.status === "approved" ? colors.success : colors.onSurfaceTertiary }]}><Text style={[styles.tagText, { color: a.status === "published" || a.status === "approved" ? colors.success : colors.onSurfaceTertiary }]}>{a.status}</Text></View></View>
              <Text style={styles.rMeta}>{a.category} · v{a.version}</Text>
              {a.status !== "published" ? <Pressable testID={`sup-kb-pub-${a.id}`} disabled={busy} style={styles.smallBtn} onPress={() => publishKb(a.id)}><Text style={styles.smallBtnText}>Publish</Text></Pressable> : null}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  backBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  backText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2 },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  rTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  ctx: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.xs },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  tagText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  prioRow: { flexDirection: "row", gap: spacing.xs, marginVertical: spacing.sm, flexWrap: "wrap" },
  prioBtn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  prioBtnText: { fontFamily: font.bold, fontSize: type.xs, textTransform: "capitalize" },
  msg: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  note: { backgroundColor: colors.warning + "12", borderColor: colors.warning + "44" },
  sender: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  msgBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 70, textAlignVertical: "top" },
  inputFlex: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  smallBtn: { alignSelf: "flex-start", borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.sm },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note2: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md },
});
