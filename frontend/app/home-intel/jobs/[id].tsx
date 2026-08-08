import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Switch, Platform, Image } from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { track } from "@/src/utils/analytics";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUSES = ["draft", "seeking_professional", "contacted", "scheduled", "in_progress", "completed", "closed"];
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", seeking_professional: "Seeking pro", contacted: "Contacted",
  scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", closed: "Closed",
};
const ITEM_ICON: Record<string, string> = {
  photo: "image-outline", document: "file-document-outline", asset_detail: "cube-outline",
  project_history: "clipboard-text-outline", maintenance_history: "wrench-outline",
  issue_note: "note-text-outline", user_note: "note-outline",
};

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [share, setShare] = useState({ include_photos: true, include_documents: true, include_address: false, allow_download: true, expires_in_days: 14 });
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/hi/jobs/${id}`);
      setData(d);
      const s = await api(`/hi/jobs/${id}/summary`);
      setSummary(s);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleItem = async (itemId: string, val: boolean) => {
    try { await api(`/hi/jobs/${id}/items/${itemId}`, { method: "PUT", body: { included_in_summary: val } }); load(); } catch {}
  };
  const removeItem = async (itemId: string) => {
    try { await api(`/hi/jobs/${id}/items/${itemId}`, { method: "DELETE" }); load(); } catch {}
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { await api(`/hi/jobs/${id}/items`, { method: "POST", body: { item_type: "user_note", note: note.trim() } }); setNote(""); load(); } catch {}
  };
  const setStatus = async (status: string) => {
    try { await api(`/hi/jobs/${id}/status`, { method: "PUT", body: { status } }); load(); } catch {}
  };

  const summaryText = () => {
    if (!summary) return "";
    const L: string[] = [];
    L.push(`JOB SUMMARY: ${summary.title}`);
    L.push(`Area: ${summary.area}`);
    L.push(`Status: ${STATUS_LABEL[summary.current_status] || summary.current_status}`);
    if (summary.issue_description) L.push(`\nIssue (as reported by homeowner):\n${summary.issue_description}`);
    if (summary.asset_details) {
      const a = summary.asset_details;
      L.push(`\nRelated equipment (documented):\n- ${[a.name, a.category, a.brand, a.model].filter(Boolean).join(" · ")}`);
    }
    if ((summary.attempted_actions || []).length) L.push(`\nActions already attempted:\n${summary.attempted_actions.map((x: string) => `- ${x}`).join("\n")}`);
    if ((summary.documents || []).length) L.push(`\nAttached documents:\n${summary.documents.map((d: any) => `- ${d.title}`).join("\n")}`);
    if ((summary.photos || []).length) L.push(`\nPhotos attached: ${summary.photos.length}`);
    if (summary.safety_notes) L.push(`\nSafety notes:\n${summary.safety_notes}`);
    L.push(`\n${summary.disclaimer}`);
    return L.join("\n");
  };

  const copy = async () => {
    try { await Clipboard.setStringAsync(summaryText()); track("job_summary_copied"); Alert.alert("Copied", "The summary is on your clipboard."); } catch {}
  };
  const download = () => {
    track("job_summary_downloaded");
    if (Platform.OS === "web") {
      const blob = new Blob([summaryText()], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `job-summary.txt`; a.click(); URL.revokeObjectURL(url);
    } else {
      Alert.alert("Download", "Open the summary on the web app to download a file, or use Copy to paste it anywhere.");
    }
  };

  const origin = () => (Platform.OS === "web" ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));
  const createShare = async () => {
    try {
      const link = await api<{ share_token: string }>(`/hi/jobs/${id}/share`, { method: "POST", body: share });
      const url = `${origin()}/shared/${link.share_token}`;
      await Clipboard.setStringAsync(url);
      setShowShare(false);
      Alert.alert("Secure link created", "The link is copied to your clipboard. It expires and can be revoked anytime.");
      load();
    } catch (e: any) { Alert.alert("Couldn't create link", e?.message || "Try again."); }
  };
  const revokeShare = async (shareId: string) => {
    try { await api(`/hi/jobs/${id}/share/${shareId}/revoke`, { method: "POST" }); load(); } catch {}
  };
  const copyShare = async (token: string) => {
    try { await Clipboard.setStringAsync(`${origin()}/shared/${token}`); Alert.alert("Copied", "Share link copied."); } catch {}
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Job summary" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const job = data.job;
  const items = data.items || [];
  const shares = data.shares || [];

  return (
    <View style={styles.root}>
      <ScreenHeader title="Job summary" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.title}>{job.title}</Text>
        {job.safety_status ? <Text style={styles.safety}>⚠︎ {job.safety_status}</Text> : null}

        <Text style={styles.section}>Status</Text>
        <View style={styles.chipRow}>
          {STATUSES.map((s) => (
            <Pressable key={s} testID={`status-${s}`} style={[styles.chip, job.status === s && styles.chipOn]} onPress={() => setStatus(s)}>
              <Text style={[styles.chipText, job.status === s && { color: "#fff" }]}>{STATUS_LABEL[s]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>What will be shared</Text>
        <Text style={styles.hint}>Toggle off anything you don&apos;t want a pro to see. Your full address is never included by default.</Text>
        {items.length === 0 ? <Text style={styles.empty}>No items yet — add a note below.</Text> :
          items.map((it: any) => (
            <View key={it.id} style={styles.itemRow} testID={`item-${it.id}`}>
              <MaterialCommunityIcons name={(ITEM_ICON[it.item_type] || "note-outline") as any} size={18} color={colors.brandPrimary} />
              <Text style={styles.itemText} numberOfLines={2}>{it.note || it.item_type.replace("_", " ")}</Text>
              <Switch testID={`item-toggle-${it.id}`} value={it.included_in_summary} onValueChange={(v) => toggleItem(it.id, v)} trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }} />
              <Pressable testID={`item-del-${it.id}`} onPress={() => removeItem(it.id)} hitSlop={8}><MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} /></Pressable>
            </View>
          ))}
        <View style={styles.noteRow}>
          <TextInput testID="add-note" style={styles.noteInput} value={note} onChangeText={setNote} placeholder="Add a note (e.g. a symptom or what you tried)" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="add-note-btn" style={styles.noteBtn} onPress={addNote}><Text style={styles.noteBtnText}>Add</Text></Pressable>
        </View>

        <Text style={styles.section}>Preview</Text>
        {summary && (
          <View style={styles.preview}>
            <Text style={styles.pvTitle}>{summary.title}</Text>
            <Text style={styles.pvMeta}>Area: {summary.area}</Text>
            {summary.issue_description ? <Text style={styles.pvBody}>{summary.issue_description}</Text> : null}
            {(summary.photos || []).length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                {summary.photos.slice(0, 6).map((p: string, i: number) => (
                  <Image key={i} source={{ uri: p.startsWith("http") || p.startsWith("data:") ? p : `data:image/jpeg;base64,${p}` }} style={styles.pvPhoto} />
                ))}
              </ScrollView>
            )}
            <Text style={styles.pvDisclaimer}>{summary.disclaimer}</Text>
          </View>
        )}

        <View style={styles.actionRow}>
          <Pressable testID="job-copy" style={styles.actionBtn} onPress={copy}><MaterialCommunityIcons name="content-copy" size={16} color={colors.brandPrimary} /><Text style={styles.actionText}>Copy</Text></Pressable>
          <Pressable testID="job-download" style={styles.actionBtn} onPress={download}><MaterialCommunityIcons name="download" size={16} color={colors.brandPrimary} /><Text style={styles.actionText}>Download</Text></Pressable>
          <Pressable testID="job-share" style={[styles.actionBtn, styles.actionPrimary]} onPress={() => setShowShare((v) => !v)}><MaterialCommunityIcons name="link-variant" size={16} color={colors.onBrandPrimary} /><Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Share link</Text></Pressable>
        </View>

        {showShare && (
          <View style={styles.shareForm}>
            {[
              ["include_photos", "Include photos"],
              ["include_documents", "Include documents"],
              ["include_address", "Include full address"],
              ["allow_download", "Allow download"],
            ].map(([k, label]) => (
              <View key={k} style={styles.shareOpt}>
                <Text style={styles.shareOptText}>{label}</Text>
                <Switch testID={`share-${k}`} value={(share as any)[k]} onValueChange={(v) => setShare((s) => ({ ...s, [k]: v }))} trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }} />
              </View>
            ))}
            <View style={styles.shareOpt}>
              <Text style={styles.shareOptText}>Expires in (days)</Text>
              <TextInput testID="share-days" style={styles.daysInput} keyboardType="number-pad" value={String(share.expires_in_days)} onChangeText={(t) => setShare((s) => ({ ...s, expires_in_days: Math.max(1, parseInt(t || "14", 10) || 14) }))} />
            </View>
            <Pressable testID="share-create" style={styles.primary} onPress={createShare}><Text style={styles.primaryText}>Create secure link</Text></Pressable>
          </View>
        )}

        {shares.length > 0 && <Text style={styles.section}>Active links</Text>}
        {shares.map((sh: any) => (
          <View key={sh.id} style={styles.shareRow} testID={`share-${sh.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareStatus}>{sh.status} · expires {(sh.expires_at || "").slice(0, 10)} · {sh.open_count || 0} opens</Text>
            </View>
            {sh.status === "active" && (
              <>
                <Pressable testID={`share-copy-${sh.id}`} onPress={() => copyShare(sh.share_token)} hitSlop={8}><MaterialCommunityIcons name="content-copy" size={18} color={colors.brandPrimary} /></Pressable>
                <Pressable testID={`share-revoke-${sh.id}`} onPress={() => revokeShare(sh.id)} hitSlop={8}><MaterialCommunityIcons name="link-off" size={18} color="#EB5757" /></Pressable>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  safety: { color: colors.warning, fontFamily: font.medium, fontSize: type.base, marginTop: 4 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.xs },
  itemText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  noteRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  noteInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  noteBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  noteBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  preview: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  pvTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  pvMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  pvBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: spacing.sm },
  pvPhoto: { width: 90, height: 90, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceTertiary },
  pvDisclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.md, lineHeight: 16, fontStyle: "italic" },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: spacing.md },
  actionPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  shareForm: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  shareOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs },
  shareOptText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  daysInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, minWidth: 64, textAlign: "center" },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  shareRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  shareStatus: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
});
