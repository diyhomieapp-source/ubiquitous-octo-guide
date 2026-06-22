import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Badge, dollars, duration, compact } from "@/src/components/CommunityBits";

type Exp = { id: string; author: string; badge?: string; location?: string; title: string; body: string; tools: string[]; cost_cents?: number; minutes?: number; cheers: number; created_at: string; seeded: boolean };
type Reply = { id: string; author: string; badge?: string; body: string };
type Thread = { id: string; author: string; badge?: string; question: string; replies: Reply[] };
type Stats = { completed: number; difficulty: number; avg_minutes: number; avg_cost_cents: number; success_rate: number };
type Detail = {
  slug: string; title: string; category: string; icon: string; blurb: string; stats: Stats;
  top_questions: string[]; common_mistakes: string[]; helpful_tips: string[];
  experiences: Exp[]; threads: Thread[]; experience_count: number;
};

export default function CommunityDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  // modals
  const [shareOpen, setShareOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // experience form
  const [exTitle, setExTitle] = useState("");
  const [exBody, setExBody] = useState("");
  const [exTools, setExTools] = useState("");
  const [exCost, setExCost] = useState("");
  const [exMin, setExMin] = useState("");
  // ask form
  const [question, setQuestion] = useState("");
  // reply
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api<Detail>(`/community/${"projects"}/${slug}`, { auth: false });
      setData(res);
    } catch {} finally { setLoading(false); }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startGuide = async () => {
    if (!data || starting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      const proj = await api<{ id: string }>("/projects", { method: "POST", body: { title: data.title, location: user?.location || "" } });
      await storage.setItem("diyhomie_active_project", proj.id);
      router.push(`/project/${proj.id}?new=1`);
    } catch {} finally { setStarting(false); }
  };

  const submitExperience = async () => {
    if (!exTitle.trim() || !exBody.trim()) return;
    setBusy(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await api(`/community/projects/${slug}/experiences`, {
        method: "POST",
        body: {
          title: exTitle.trim(), body: exBody.trim(),
          tools: exTools.split(",").map((t) => t.trim()).filter(Boolean),
          cost_cents: exCost ? Math.round(parseFloat(exCost) * 100) : null,
          minutes: exMin ? parseInt(exMin, 10) : null,
        },
      });
      setExTitle(""); setExBody(""); setExTools(""); setExCost(""); setExMin("");
      setShareOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  const submitQuestion = async () => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      await api(`/community/projects/${slug}/threads`, { method: "POST", body: { question: question.trim() } });
      setQuestion(""); setAskOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  const sendReply = async (threadId: string) => {
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await api(`/community/threads/${threadId}/replies`, { method: "POST", body: { body: replyText.trim() } });
      setReplyText(""); setReplyTo(null);
      await load();
    } finally { setBusy(false); }
  };

  const cheer = async (expId: string) => {
    Haptics.selectionAsync();
    setData((d) => d ? { ...d, experiences: d.experiences.map((e) => e.id === expId ? { ...e, cheers: e.cheers + 1 } : e) } : d);
    try { await api(`/community/experiences/${expId}/cheer`, { method: "POST" }); } catch {}
  };

  if (loading || !data) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Community" />
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      </View>
    );
  }

  const s = data.stats;

  return (
    <View style={styles.root}>
      <ScreenHeader title={data.category} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
      >
        {/* title */}
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><MaterialCommunityIcons name={data.icon as any} size={30} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{data.title}</Text>
            <Text style={styles.blurb}>{data.blurb}</Text>
          </View>
        </View>

        {/* AI first CTA */}
        <Pressable testID="community-ai-cta" style={styles.aiCta} onPress={startGuide} disabled={starting}>
          <MaterialCommunityIcons name="robot-happy-outline" size={24} color={colors.onBrandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.aiCtaTitle}>{starting ? "STARTING…" : "GET YOUR AI GUIDE"}</Text>
            <Text style={styles.aiCtaSub}>Homie builds you a personalized step-by-step plan</Text>
          </View>
          <MaterialCommunityIcons name="arrow-right" size={22} color={colors.onBrandPrimary} />
        </Pressable>

        {/* stats grid */}
        <View style={styles.statsGrid}>
          <Stat icon="account-group" value={compact(s.completed)} label="COMPLETED" />
          <Stat icon="clock-outline" value={duration(s.avg_minutes)} label="AVG TIME" />
          <Stat icon="speedometer" value={`${s.difficulty}/10`} label="DIFFICULTY" />
          <Stat icon="cash" value={dollars(s.avg_cost_cents)} label="AVG COST" />
          <Stat icon="check-decagram" value={`${s.success_rate}%`} label="SUCCESS" color={colors.success} />
          <Stat icon="comment-multiple-outline" value={`${data.experience_count}`} label="STORIES" />
        </View>

        {/* experiences */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>REAL HOMEOWNER EXPERIENCES</Text>
          <Pressable testID="share-experience-btn" style={styles.addBtn} onPress={() => setShareOpen(true)}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} />
            <Text style={styles.addBtnText}>SHARE</Text>
          </Pressable>
        </View>
        {data.experiences.map((e) => (
          <View key={e.id} style={styles.expCard}>
            <View style={styles.expTop}>
              <View style={styles.expAvatar}><Text style={styles.expAvatarText}>{e.author.charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.expAuthor}>{e.author}</Text>
                {!!e.location && <Text style={styles.expLoc}>{e.location}</Text>}
              </View>
              <Badge label={e.badge} small />
            </View>
            <Text style={styles.expTitle}>{e.title}</Text>
            <Text style={styles.expBody}>{e.body}</Text>
            {e.tools.length > 0 && (
              <View style={styles.toolRow}>
                {e.tools.map((t) => (
                  <View key={t} style={styles.toolChip}><Text style={styles.toolChipText}>{t}</Text></View>
                ))}
              </View>
            )}
            <View style={styles.expFooter}>
              {(e.minutes != null) && <Meta icon="clock-outline" text={duration(e.minutes)} />}
              {(e.cost_cents != null) && <Meta icon="cash" text={dollars(e.cost_cents)} />}
              <Pressable testID={`cheer-${e.id}`} style={styles.cheerBtn} onPress={() => cheer(e.id)}>
                <MaterialCommunityIcons name="hand-clap" size={15} color={colors.brandPrimary} />
                <Text style={styles.cheerText}>{e.cheers}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* top questions */}
        <ListBlock title="TOP QUESTIONS" icon="help-circle-outline" items={data.top_questions} />
        {/* helpful tips */}
        <ListBlock title="HELPFUL TIPS" icon="lightbulb-on-outline" items={data.helpful_tips} accent={colors.success} />
        {/* common mistakes */}
        <ListBlock title="COMMON MISTAKES" icon="alert-outline" items={data.common_mistakes} accent={colors.warning} />

        {/* threads */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>ASK SOMEONE WHO'S DONE THIS</Text>
          <Pressable testID="ask-question-btn" style={styles.addBtn} onPress={() => setAskOpen(true)}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} />
            <Text style={styles.addBtnText}>ASK</Text>
          </Pressable>
        </View>
        {data.threads.map((th) => (
          <View key={th.id} style={styles.threadCard}>
            <View style={styles.threadHead}>
              <MaterialCommunityIcons name="comment-question-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.threadQ}>{th.question}</Text>
            </View>
            <Text style={styles.threadAuthor}>asked by {th.author}</Text>
            {th.replies.map((r) => (
              <View key={r.id} style={styles.replyCard}>
                <View style={styles.replyHead}>
                  <Text style={styles.replyAuthor}>{r.author}</Text>
                  <Badge label={r.badge} small />
                </View>
                <Text style={styles.replyBody}>{r.body}</Text>
              </View>
            ))}
            {replyTo === th.id ? (
              <View style={styles.replyComposer}>
                <TextInput
                  testID={`reply-input-${th.id}`}
                  style={styles.replyInput}
                  placeholder="Share what worked for you…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={replyText}
                  onChangeText={setReplyText}
                  autoFocus
                />
                <Pressable testID={`reply-send-${th.id}`} style={styles.replySend} onPress={() => sendReply(th.id)} disabled={busy || !replyText.trim()}>
                  <MaterialCommunityIcons name="send" size={16} color={colors.onBrandPrimary} />
                </Pressable>
              </View>
            ) : (
              <Pressable testID={`reply-open-${th.id}`} style={styles.replyOpen} onPress={() => { setReplyTo(th.id); setReplyText(""); }}>
                <MaterialCommunityIcons name="reply" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.replyOpenText}>Answer this</Text>
              </Pressable>
            )}
          </View>
        ))}
        {data.threads.length === 0 && (
          <Text style={styles.emptyThreads}>No questions yet — be the first to ask someone who's installed this.</Text>
        )}
      </ScrollView>

      {/* share experience modal */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>SHARE YOUR EXPERIENCE</Text>
              <Text style={styles.sheetSub}>Help the next homeowner tackling {data.title.toLowerCase()}.</Text>
              <TextInput testID="ex-title" style={styles.input} placeholder="Headline (e.g. Done in 90 minutes)" placeholderTextColor={colors.onSurfaceTertiary} value={exTitle} onChangeText={setExTitle} />
              <TextInput testID="ex-body" style={[styles.input, { height: 110, textAlignVertical: "top" }]} placeholder="What did you do? Any surprises or tips?" placeholderTextColor={colors.onSurfaceTertiary} value={exBody} onChangeText={setExBody} multiline />
              <TextInput testID="ex-tools" style={styles.input} placeholder="Tools used (comma separated)" placeholderTextColor={colors.onSurfaceTertiary} value={exTools} onChangeText={setExTools} />
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <TextInput testID="ex-cost" style={[styles.input, { flex: 1 }]} placeholder="Cost $" placeholderTextColor={colors.onSurfaceTertiary} value={exCost} onChangeText={setExCost} keyboardType="numeric" />
                <TextInput testID="ex-min" style={[styles.input, { flex: 1 }]} placeholder="Minutes" placeholderTextColor={colors.onSurfaceTertiary} value={exMin} onChangeText={setExMin} keyboardType="numeric" />
              </View>
              <Pressable testID="ex-submit" style={styles.primaryBtn} onPress={submitExperience} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>POST EXPERIENCE</Text>}
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={() => setShareOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ask question modal */}
      <Modal visible={askOpen} transparent animationType="slide" onRequestClose={() => setAskOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>ASK A QUESTION</Text>
            <Text style={styles.sheetSub}>Homeowners who completed {data.title.toLowerCase()} will see it.</Text>
            <TextInput testID="ask-input" style={[styles.input, { height: 90, textAlignVertical: "top" }]} placeholder="What do you want to know?" placeholderTextColor={colors.onSurfaceTertiary} value={question} onChangeText={setQuestion} multiline />
            <Pressable testID="ask-submit" style={styles.primaryBtn} onPress={submitQuestion} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>POST QUESTION</Text>}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setAskOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Stat({ icon, value, label, color }: { icon: any; value: string; label: string; color?: string }) {
  return (
    <View style={styles.statBox}>
      <MaterialCommunityIcons name={icon} size={18} color={color || colors.brandPrimary} />
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Meta({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.meta}>
      <MaterialCommunityIcons name={icon} size={14} color={colors.onSurfaceTertiary} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function ListBlock({ title, icon, items, accent }: { title: string; icon: any; items: string[]; accent?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{title}</Text></View>
      <View style={styles.listCard}>
        {items.map((it, i) => (
          <View key={i} style={[styles.listRow, i < items.length - 1 && styles.listBorder]}>
            <MaterialCommunityIcons name={icon} size={18} color={accent || colors.brandPrimary} />
            <Text style={styles.listText}>{it}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  titleIcon: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 30, lineHeight: 32 },
  blurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19, marginTop: 2 },
  aiCta: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
  aiCtaTitle: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  aiCtaSub: { color: colors.onBrandPrimary, fontFamily: font.regular, fontSize: type.sm, opacity: 0.9, marginTop: 1 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  statBox: { width: "31.5%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", borderColor: colors.border, borderWidth: 1, gap: 2 },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, lineHeight: 26 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 3, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  addBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  expCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.md },
  expTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  expAvatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  expAvatarText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  expAuthor: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  expLoc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  expTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: 4 },
  expBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  toolChip: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  toolChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  expFooter: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  cheerBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  cheerText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  listCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md },
  listBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  listText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  threadCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.md },
  threadHead: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  threadQ: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, lineHeight: 21 },
  threadAuthor: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, marginBottom: spacing.sm },
  replyCard: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm, borderLeftColor: colors.brandPrimary, borderLeftWidth: 2 },
  replyHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  replyAuthor: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  replyBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  replyOpen: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  replyOpenText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  replyComposer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  replyInput: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  replySend: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  emptyThreads: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingVertical: spacing.lg },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "88%" },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, letterSpacing: 1 },
  sheetSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.md, marginTop: 2 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
