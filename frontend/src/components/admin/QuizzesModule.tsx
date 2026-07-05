import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Row = { id: string; topic: string; title: string; level: string; question_count: number; pass_pct: number; active: boolean; attempts: number; pass_rate: number };
type TopicStat = { topic: string; attempts: number; passed: number; avg_score: number; pass_rate: number };
type QDraft = { q: string; options: string[]; answer: number; explanation: string };

export function QuizzesModule() {
  const [rows, setRows] = useState<Row[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [totals, setTotals] = useState<any | null>(null);
  const [byTopic, setByTopic] = useState<TopicStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, an] = await Promise.all([
        api<{ quizzes: Row[]; topics: string[] }>("/admin/quizzes"),
        api<{ totals: any; by_topic: TopicStat[] }>("/admin/quizzes/analytics"),
      ]);
      setRows(list.quizzes); setTopics(list.topics); setTotals(an.totals); setByTopic(an.by_topic);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: string) => { try { await api(`/admin/quizzes/${id}/toggle`, { method: "POST" }); load(); } catch {} };
  const remove = async (id: string) => { try { await api(`/admin/quizzes/${id}`, { method: "DELETE" }); load(); } catch {} };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Skill Quizzes</Text>
          <Text style={styles.sub}>Just-in-time training. Launch or tune quizzes with no code deploy.</Text>
        </View>
        <Pressable testID="quiz-add-toggle" style={[styles.btn, styles.btnOk]} onPress={() => setAdding((a) => !a)}>
          <MaterialCommunityIcons name={adding ? "close" : "plus"} size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{adding ? "Close" : "New quiz"}</Text>
        </Pressable>
      </View>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Quizzes" value={String(totals.quizzes)} />
          <Stat label="Attempts" value={String(totals.attempts)} />
          <Stat label="Learners" value={String(totals.learners)} />
          <Stat label="Pass rate" value={`${totals.pass_rate}%`} />
        </View>
      )}

      {adding && <AddQuiz topics={topics} onCreated={() => { setAdding(false); load(); }} />}

      {byTopic.length > 0 && <Text style={styles.section}>Pass rate by topic</Text>}
      {byTopic.map((t) => (
        <View key={t.topic} style={styles.topicRow}>
          <Text style={styles.name}>{t.topic}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.meta}>{t.attempts} tries · avg {t.avg_score}% · pass {t.pass_rate}%</Text>
        </View>
      ))}

      <Text style={styles.section}>All quizzes</Text>
      {rows.map((q) => (
        <View key={q.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{q.title}</Text>
              <Text style={styles.meta}>{q.topic} · {q.level} · {q.question_count}q · pass {q.pass_pct}% · {q.attempts} attempts ({q.pass_rate}%)</Text>
            </View>
            <Pressable testID={`quiz-toggle-${q.id}`} style={[styles.switch, q.active && styles.switchOn]} onPress={() => toggle(q.id)}><View style={[styles.knob, q.active && styles.knobOn]} /></Pressable>
            <Pressable testID={`quiz-del-${q.id}`} onPress={() => remove(q.id)} hitSlop={8} style={{ marginLeft: spacing.sm }}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function AddQuiz({ topics, onCreated }: { topics: string[]; onCreated: () => void }) {
  const [topic, setTopic] = useState(topics[0] || "Safety Basics");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("Beginner");
  const [triggers, setTriggers] = useState("");
  const [passPct, setPassPct] = useState("70");
  const [qs, setQs] = useState<QDraft[]>([{ q: "", options: ["", ""], answer: 0, explanation: "" }]);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = qs.filter((x) => x.q.trim() && x.options.filter((o) => o.trim()).length >= 2);
    if (!title.trim() || clean.length === 0) { Alert.alert("Missing", "Add a title and at least one question with 2+ options."); return; }
    setBusy(true);
    try {
      await api("/admin/quizzes", { method: "POST", body: {
        topic, title: title.trim(), level, pass_pct: parseInt(passPct) || 70,
        triggers: triggers.split(",").map((t) => t.trim()).filter(Boolean),
        questions: clean.map((x) => ({ q: x.q.trim(), options: x.options.filter((o) => o.trim()), answer: Math.min(x.answer, x.options.filter((o) => o.trim()).length - 1), explanation: x.explanation.trim() })),
      } });
      onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.form}>
      <View style={styles.chipRow}>{topics.map((t) => <Pressable key={t} style={[styles.chip, topic === t && styles.chipOn]} onPress={() => setTopic(t)}><Text style={[styles.chipText, topic === t && styles.chipTextOn]}>{t}</Text></Pressable>)}</View>
      <TextInput testID="quiz-new-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Quiz title" placeholderTextColor={colors.onSurfaceTertiary} />
      <View style={styles.chipRow}>
        {["Beginner", "Intermediate", "Advanced"].map((l) => <Pressable key={l} style={[styles.chip, level === l && styles.chipOn]} onPress={() => setLevel(l)}><Text style={[styles.chipText, level === l && styles.chipTextOn]}>{l}</Text></Pressable>)}
        <TextInput style={[styles.input, { width: 70, marginBottom: 0 }]} value={passPct} onChangeText={setPassPct} keyboardType="numeric" placeholder="pass%" placeholderTextColor={colors.onSurfaceTertiary} />
      </View>
      <TextInput style={styles.input} value={triggers} onChangeText={setTriggers} placeholder="Trigger keywords (comma separated: tile, grout)" placeholderTextColor={colors.onSurfaceTertiary} />

      {qs.map((q, qi) => (
        <View key={qi} style={styles.qEdit}>
          <TextInput style={styles.input} value={q.q} onChangeText={(t) => setQs((s) => s.map((x, j) => j === qi ? { ...x, q: t } : x))} placeholder={`Question ${qi + 1}`} placeholderTextColor={colors.onSurfaceTertiary} />
          {q.options.map((opt, oi) => (
            <View key={oi} style={styles.optLine}>
              <Pressable testID={`quiz-ans-${qi}-${oi}`} style={[styles.ansDot, q.answer === oi && styles.ansDotOn]} onPress={() => setQs((s) => s.map((x, j) => j === qi ? { ...x, answer: oi } : x))}>{q.answer === oi && <MaterialCommunityIcons name="check" size={12} color={colors.onBrandPrimary} />}</Pressable>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={opt} onChangeText={(t) => setQs((s) => s.map((x, j) => j === qi ? { ...x, options: x.options.map((o, k) => k === oi ? t : o) } : x))} placeholder={`Option ${oi + 1}${q.answer === oi ? " (correct)" : ""}`} placeholderTextColor={colors.onSurfaceTertiary} />
            </View>
          ))}
          <Pressable style={styles.linkBtn} onPress={() => setQs((s) => s.map((x, j) => j === qi ? { ...x, options: [...x.options, ""] } : x))}><Text style={styles.linkText}>+ Option</Text></Pressable>
          <TextInput style={styles.input} value={q.explanation} onChangeText={(t) => setQs((s) => s.map((x, j) => j === qi ? { ...x, explanation: t } : x))} placeholder="Explanation (shown after answering)" placeholderTextColor={colors.onSurfaceTertiary} />
        </View>
      ))}
      <Pressable testID="quiz-add-q" style={styles.linkBtn} onPress={() => setQs((s) => [...s, { q: "", options: ["", ""], answer: 0, explanation: "" }])}><Text style={styles.linkText}>+ Add question</Text></Pressable>

      <Pressable testID="quiz-new-create" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={create} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Launch quiz</Text></>}
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 66, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  topicRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  qEdit: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, gap: 4 },
  optLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ansDot: { width: 24, height: 24, borderRadius: 12, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  ansDotOn: { backgroundColor: colors.success, borderColor: colors.success },
  linkBtn: { paddingVertical: 2 },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
