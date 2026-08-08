import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const REPORT_REASONS = ["unsafe", "inaccurate", "spam", "copyright", "privacy", "abusive", "other"];

export default function CommunityDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<any>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentsOff, setCommentsOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/hi/community/content/${id}`);
      setC(r.content); setMyVote(r.my_vote || null); setSaved(!!r.saved);
      try { const cm = await api<any>(`/hi/community/content/${id}/comments`); setComments(cm.comments || []); }
      catch { setCommentsOff(true); }
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const vote = async (t: string) => { setBusy(true); try { const r = await api<any>(`/hi/community/content/${id}/vote`, { method: "POST", body: { vote_type: t } }); setMyVote(t); setC((p: any) => ({ ...p, helpful_count: r.helpful_count })); } catch {} finally { setBusy(false); } };
  const toggleSave = async () => { setBusy(true); try { if (saved) { await api(`/hi/community/content/${id}/save`, { method: "DELETE" }); setSaved(false); } else { await api(`/hi/community/content/${id}/save`, { method: "POST" }); setSaved(true); } } catch {} finally { setBusy(false); } };
  const report = (reason: string) => { setReporting(false); setBusy(true); api(`/hi/community/content/${id}/report`, { method: "POST", body: { report_reason: reason } }).then(() => Alert.alert("Reported", "Thanks — our team will review it.")).catch((e) => Alert.alert("Couldn't report", e?.message || "Try again.")).finally(() => setBusy(false)); };
  const postComment = async () => {
    if (!commentBody.trim()) return;
    setBusy(true);
    try { const r = await api<any>(`/hi/community/content/${id}/comments`, { method: "POST", body: { body: commentBody } }); setCommentBody(""); Alert.alert(r.pending_review ? "Sent for review" : "Posted", r.pending_review ? "Your comment will appear after a quick review." : "Comment posted."); await load(); }
    catch (e: any) { Alert.alert("Couldn't post", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !c) return <View style={styles.root}><ScreenHeader title="Community" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Community" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.labelRow}><Text style={styles.expLabel}>COMMUNITY EXPERIENCE</Text><Text style={styles.cat}>{c.category}</Text></View>
        <Text style={styles.title}>{c.title}</Text>
        <Text style={styles.meta}>{c.author_label || "Anonymous"} · {String(c.published_at || "").slice(0, 10)} · {c.helpful_count} helpful</Text>
        <View style={styles.disclaimer}><MaterialCommunityIcons name="information-outline" size={16} color={colors.onSurfaceTertiary} /><Text style={styles.disclaimerText}>{c.disclaimer || "Not a substitute for professional advice."}</Text></View>
        <Text style={styles.body}>{c.body}</Text>
        {c.safety_classification === "high_risk" ? <Text style={styles.riskNote}>⚠ This touches a high-risk area. When in doubt, stop and consult a licensed pro.</Text> : null}

        <View style={styles.actions}>
          <Pressable testID="cd-helpful" disabled={busy} style={[styles.actBtn, myVote === "helpful" && styles.actOn]} onPress={() => vote("helpful")}><MaterialCommunityIcons name="thumb-up-outline" size={18} color={myVote === "helpful" ? colors.brandPrimary : colors.onSurfaceSecondary} /><Text style={[styles.actText, myVote === "helpful" && { color: colors.brandPrimary }]}>Helpful</Text></Pressable>
          <Pressable testID="cd-save" disabled={busy} style={[styles.actBtn, saved && styles.actOn]} onPress={toggleSave}><MaterialCommunityIcons name={saved ? "bookmark" : "bookmark-outline"} size={18} color={saved ? colors.brandPrimary : colors.onSurfaceSecondary} /><Text style={[styles.actText, saved && { color: colors.brandPrimary }]}>{saved ? "Saved" : "Save"}</Text></Pressable>
          <Pressable testID="cd-ask" disabled={busy} style={styles.actBtn} onPress={() => router.push("/home-intel/voice")}><MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.onSurfaceSecondary} /><Text style={styles.actText}>Ask Homie</Text></Pressable>
          <Pressable testID="cd-report" disabled={busy} style={styles.actBtn} onPress={() => setReporting((v) => !v)}><MaterialCommunityIcons name="flag-outline" size={18} color={colors.onSurfaceSecondary} /><Text style={styles.actText}>Report</Text></Pressable>
        </View>

        {reporting && (
          <View style={styles.reportBox}>
            <Text style={styles.reportTitle}>Why are you reporting this?</Text>
            <View style={styles.chipWrap}>{REPORT_REASONS.map((rr) => <Pressable key={rr} testID={`cd-reason-${rr}`} style={styles.chip} onPress={() => report(rr)}><Text style={styles.chipText}>{rr}</Text></Pressable>)}</View>
          </View>
        )}

        <Text style={styles.section}>Comments</Text>
        {commentsOff ? <Text style={styles.empty}>Comments are turned off for high-risk safety categories.</Text> : (
          <>
            {comments.length === 0 ? <Text style={styles.empty}>No comments yet.</Text> : comments.map((cm) => <View key={cm.id} style={styles.comment}><Text style={styles.commentBody}>{cm.body}</Text><Text style={styles.commentMeta}>{String(cm.created_at).slice(0, 10)}</Text></View>)}
            <View style={styles.commentRow}>
              <TextInput testID="cd-comment-input" value={commentBody} onChangeText={setCommentBody} placeholder="Add a comment…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.commentInput} />
              <Pressable testID="cd-comment-send" disabled={busy || !commentBody.trim()} style={[styles.sendBtn, (busy || !commentBody.trim()) && { opacity: 0.5 }]} onPress={postComment}><MaterialCommunityIcons name="send" size={18} color="#fff" /></Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  expLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  cat: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"], marginTop: spacing.sm },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4 },
  disclaimer: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.md },
  disclaimerText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs },
  body: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 23, marginTop: spacing.md },
  riskNote: { color: "#EB5757", fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  actOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
  actText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.xs },
  reportBox: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  reportTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  comment: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  commentBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  commentMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4 },
  commentRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, alignItems: "center" },
  commentInput: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
