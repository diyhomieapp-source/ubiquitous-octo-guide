import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CONTENT_TYPES = [
  { key: "CommunityProject", label: "Project story" },
  { key: "CommunityTip", label: "Tip / lesson" },
  { key: "CommunityAnswer", label: "Helpful answer" },
  { key: "CommunityQuestion", label: "Question" },
];
const VIS = [
  { key: "anonymous_community", label: "Anonymous", desc: "No name or address shown" },
  { key: "attributed_community", label: "Under my name", desc: "Shown with your display name" },
  { key: "unlisted_share", label: "Unlisted link", desc: "Only people with the link" },
];

export default function Contribute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [cats, setCats] = useState<string[]>([]);
  const [cid, setCid] = useState<string | null>(id || null);
  const [ctype, setCtype] = useState("CommunityTip");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("Project Lessons");
  const [difficulty, setDifficulty] = useState("");
  const [vis, setVis] = useState("anonymous_community");
  const [rawNotes, setRawNotes] = useState("");
  const [sensitive, setSensitive] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const c = await api<any>("/hi/community/categories");
      setCats(c.categories || []);
      if (id) {
        const mine = await api<any>("/hi/community/content/mine");
        const found = (mine.content || []).find((x: any) => x.id === id);
        if (found) { setCtype(found.content_type); setTitle(found.title); setBody(found.body); setCategory(found.category); setDifficulty(found.difficulty || ""); setVis(found.visibility === "draft" ? "anonymous_community" : found.visibility); }
      }
    } catch {} finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const assist = async () => {
    if (!rawNotes.trim()) { Alert.alert("Notes needed", "Jot a few notes and I'll help shape them."); return; }
    setBusy(true);
    try {
      const r = await api<any>("/hi/community/draft-assist", { method: "POST", body: { raw_notes: rawNotes } });
      const d = r.draft;
      setTitle(d.suggested_title || ""); 
      const parts = [d.summary, d.what_went_well && `What went well: ${d.what_went_well}`, d.what_was_difficult && `What was tricky: ${d.what_was_difficult}`, (d.lessons || []).length ? `Lessons: ${(d.lessons || []).join("; ")}` : ""].filter(Boolean);
      setBody(parts.join("\n\n"));
      if (d.suggested_category && (cats.includes(d.suggested_category))) setCategory(d.suggested_category);
      setSensitive(d.sensitive_info_found || []);
    } catch (e: any) { Alert.alert("Couldn't help", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const saveDraft = async (): Promise<string | null> => {
    if (!title.trim() || !body.trim()) { Alert.alert("Almost there", "Add a title and details first."); return null; }
    if (cid) { await api(`/hi/community/content/${cid}`, { method: "PUT", body: { title, body, category, difficulty: difficulty || null } }); return cid; }
    const r = await api<any>("/hi/community/content", { method: "POST", body: { content_type: ctype, title, body, category, difficulty: difficulty || null, visibility: "draft" } });
    if ((r.pre_checks?.flags || []).includes("personal_information")) setSensitive((s) => Array.from(new Set([...s, "Looks like personal info — please remove before sharing"])));
    setCid(r.content.id); return r.content.id;
  };

  const submit = async () => {
    setBusy(true);
    try {
      const savedId = await saveDraft();
      if (!savedId) return;
      const r = await api<any>(`/hi/community/content/${savedId}/submit`, { method: "POST", body: { visibility: vis } });
      Alert.alert("Submitted for review", r.note, [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Share a project" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Share a project" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.lead}>Would you like to help another homeowner? Nothing is shared until you submit and it's reviewed.</Text>

        <Text style={styles.label}>Jot rough notes (optional) — Homie can shape them</Text>
        <TextInput testID="ch-raw-notes" value={rawNotes} onChangeText={setRawNotes} placeholder="e.g. replaced kitchen faucet, tricky shutoff valve, took 2 hrs…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { minHeight: 70 }]} multiline />
        <Pressable testID="ch-assist" disabled={busy} style={styles.assistBtn} onPress={assist}>{busy ? <ActivityIndicator color={colors.brandPrimary} size="small" /> : <><MaterialCommunityIcons name="auto-fix" size={16} color={colors.brandPrimary} /><Text style={styles.assistText}>Help me write it</Text></>}</Pressable>

        {sensitive.length > 0 && (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>⚠ Please review before sharing</Text>
            {sensitive.map((s, i) => <Text key={i} style={styles.warnItem}>• {s}</Text>)}
          </View>
        )}

        <Text style={styles.label}>Type</Text>
        <View style={styles.chipWrap}>{CONTENT_TYPES.map((t) => <Pressable key={t.key} testID={`ch-type-${t.key}`} style={[styles.chip, ctype === t.key && styles.chipOn]} onPress={() => setCtype(t.key)}><Text style={[styles.chipText, ctype === t.key && styles.chipTextOn]}>{t.label}</Text></Pressable>)}</View>

        <Text style={styles.label}>Title</Text>
        <TextInput testID="ch-title" value={title} onChangeText={setTitle} placeholder="Short, clear title" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

        <Text style={styles.label}>Details</Text>
        <TextInput testID="ch-body" value={body} onChangeText={setBody} placeholder="What you did, what went well, what was tricky, lessons learned…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { minHeight: 120 }]} multiline />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipWrap}>{cats.map((c) => <Pressable key={c} testID={`ch-cat-${c}`} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>)}</View>

        <Text style={styles.label}>How would you like to share?</Text>
        {VIS.map((v) => (
          <Pressable key={v.key} testID={`ch-vis-${v.key}`} style={[styles.visRow, vis === v.key && styles.visOn]} onPress={() => setVis(v.key)}>
            <MaterialCommunityIcons name={vis === v.key ? "radiobox-marked" : "radiobox-blank"} size={20} color={vis === v.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}><Text style={styles.visLabel}>{v.label}</Text><Text style={styles.visDesc}>{v.desc}</Text></View>
          </Pressable>
        ))}

        <Pressable testID="ch-submit" disabled={busy} style={[styles.submitBtn, busy && { opacity: 0.6 }]} onPress={submit}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit for review</Text>}</Pressable>
        <Text style={styles.note}>We review posts before publishing. Safety-sensitive posts (like electrical or plumbing) get extra review. You can edit or withdraw anytime.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  lead: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: spacing.md },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  assistBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, marginTop: spacing.sm },
  assistText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  warnBox: { backgroundColor: "#F2994A18", borderColor: "#F2994A", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  warnTitle: { color: "#F2994A", fontFamily: font.bold, fontSize: type.sm },
  warnItem: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginTop: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  chipTextOn: { color: colors.brandPrimary },
  visRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  visOn: { borderColor: colors.brandPrimary },
  visLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  visDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.lg },
  submitText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.md },
});
