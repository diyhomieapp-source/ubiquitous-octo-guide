import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type QuizRow = { id: string; topic: string; title: string; level: string; question_count: number; pass_pct: number; passed: boolean; best_score: number };
type Question = { idx: number; q: string; options: string[] };
type QuizDetail = { id: string; topic: string; title: string; level: string; pass_pct: number; question_count: number; questions: Question[] };
type Result = { idx: number; correct: boolean; your_answer: number; answer: number; explanation: string };
type Graded = { score_pct: number; correct: number; total: number; passed: boolean; results: Result[]; recommendation: { type: string; message: string; mentor_invite: boolean; learn_url?: string } };
type Skills = { topics: { topic: string; best_score: number; passed: boolean; attempts: number; badge: string | null }[]; badges: string[]; passed_count: number; total_topics: number; mentor_optin: boolean; mentor_eligible: boolean };
type Leader = { name: string; badges: number; is_me: boolean };

const LEVEL_COLOR: Record<string, string> = { Beginner: "#27AE60", Intermediate: "#2F80ED", Advanced: "#EB5757" };

export default function SkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ quizId?: string }>();
  const [skills, setSkills] = useState<Skills | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, q, l] = await Promise.all([
        api<Skills>("/skills/me"),
        api<{ quizzes: QuizRow[] }>("/quizzes"),
        api<{ leaderboard: Leader[] }>("/skills/leaderboard"),
      ]);
      setSkills(s); setQuizzes(q.quizzes); setLeaders(l.leaderboard);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    load();
    if (params.quizId) setActive(params.quizId);
  }, [load, params.quizId]));

  const toggleMentor = async () => {
    if (!skills) return;
    try { await api("/skills/mentor-optin", { method: "POST", body: { enabled: !skills.mentor_optin } }); load(); } catch {}
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="skills-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Skill Builder</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>SKILLS MASTERED</Text>
            <Text style={styles.heroValue}>{skills?.passed_count || 0}<Text style={styles.heroOf}> / {skills?.total_topics || 0}</Text></Text>
            {!!(skills?.badges.length) && (
              <View style={styles.badgeWrap}>
                {skills!.badges.map((b) => (
                  <View key={b} style={styles.badge}><MaterialCommunityIcons name="medal-outline" size={13} color={colors.onBrandPrimary} /><Text style={styles.badgeText}>{b}</Text></View>
                ))}
              </View>
            )}
          </View>

          {skills?.mentor_eligible && (
            <Pressable testID="skills-mentor" style={[styles.mentorCard, skills.mentor_optin && styles.mentorOn]} onPress={toggleMentor}>
              <MaterialCommunityIcons name="account-star-outline" size={22} color={skills.mentor_optin ? colors.onBrandPrimary : colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.mentorTitle, skills.mentor_optin && { color: colors.onBrandPrimary }]}>{skills.mentor_optin ? "You're a community mentor 🎉" : "Become a community mentor"}</Text>
                <Text style={[styles.mentorSub, skills.mentor_optin && { color: colors.onBrandPrimary, opacity: 0.85 }]}>You aced a quiz! Opt in to help new DIYers and appear on the leaderboard.</Text>
              </View>
              <View style={[styles.switch, skills.mentor_optin && styles.switchOn]}><View style={[styles.knob, skills.mentor_optin && styles.knobOn]} /></View>
            </Pressable>
          )}

          <Text style={styles.section}>Take a skill check</Text>
          {quizzes.map((q) => (
            <Pressable key={q.id} testID={`quiz-${q.id}`} style={styles.card} onPress={() => { Haptics.selectionAsync(); setActive(q.id); }}>
              <View style={styles.iconWrap}><MaterialCommunityIcons name={q.passed ? "check-decagram" : "help-circle-outline"} size={22} color={q.passed ? colors.success : colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qTitle}>{q.title}</Text>
                <Text style={styles.meta}>{q.topic} · {q.question_count} questions · pass {q.pass_pct}%</Text>
              </View>
              <View style={[styles.level, { backgroundColor: (LEVEL_COLOR[q.level] || colors.onSurfaceTertiary) + "22" }]}>
                <Text style={[styles.levelText, { color: LEVEL_COLOR[q.level] || colors.onSurfaceTertiary }]}>{q.passed ? "PASSED" : q.level}</Text>
              </View>
            </Pressable>
          ))}

          <Text style={styles.section}>Leaderboard</Text>
          {leaders.length === 0 && <Text style={styles.empty}>Be the first to earn a skill badge!</Text>}
          {leaders.map((l, i) => (
            <View key={i} style={[styles.leaderRow, l.is_me && styles.leaderMe]}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Text style={[styles.leaderName, l.is_me && { color: colors.brandPrimary }]}>{l.name}{l.is_me ? " (you)" : ""}</Text>
              <View style={{ flex: 1 }} />
              <MaterialCommunityIcons name="medal-outline" size={15} color={colors.warning} />
              <Text style={styles.leaderBadges}>{l.badges}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {active && <QuizModal quizId={active} onClose={() => setActive(null)} onDone={load} />}
    </View>
  );
}

function QuizModal({ quizId, onClose, onDone }: { quizId: string; onClose: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [graded, setGraded] = useState<Graded | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const q = await api<QuizDetail>(`/quizzes/${quizId}`); setQuiz(q); } catch {}
  }, [quizId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!quiz) return;
    const arr = quiz.questions.map((q) => (answers[q.idx] ?? -1));
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { const g = await api<Graded>(`/quizzes/${quizId}/submit`, { method: "POST", body: { answers: arr } }); setGraded(g); onDone(); } catch {} finally { setBusy(false); }
  };

  if (!quiz) return <View style={styles.overlay}><View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}><ActivityIndicator color={colors.brandPrimary} /></View></View>;
  const allAnswered = quiz.questions.every((q) => answers[q.idx] != null);

  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, maxHeight: "90%" }]}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.qTitle}>{quiz.title}</Text>
            <Text style={styles.meta}>{quiz.topic} · pass {quiz.pass_pct}%</Text>
          </View>
          <Pressable testID="quiz-close" onPress={onClose} hitSlop={8}><MaterialCommunityIcons name="close" size={22} color={colors.onSurface} /></Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {!graded ? (
            quiz.questions.map((q) => (
              <View key={q.idx} style={styles.qBlock}>
                <Text style={styles.qText}>{q.idx + 1}. {q.q}</Text>
                {q.options.map((opt, oi) => (
                  <Pressable key={oi} testID={`quiz-q${q.idx}-opt${oi}`} style={[styles.opt, answers[q.idx] === oi && styles.optOn]} onPress={() => setAnswers((a) => ({ ...a, [q.idx]: oi }))}>
                    <View style={[styles.radio, answers[q.idx] === oi && styles.radioOn]}>{answers[q.idx] === oi && <View style={styles.radioDot} />}</View>
                    <Text style={[styles.optText, answers[q.idx] === oi && { color: colors.onSurface }]}>{opt}</Text>
                  </Pressable>
                ))}
              </View>
            ))
          ) : (
            <View>
              <View style={[styles.scoreCard, { backgroundColor: (graded.passed ? colors.success : colors.warning) + "18" }]}>
                <MaterialCommunityIcons name={graded.passed ? "trophy-outline" : "school-outline"} size={30} color={graded.passed ? colors.success : colors.warning} />
                <Text style={styles.scoreVal}>{graded.score_pct}%</Text>
                <Text style={styles.scoreMsg}>{graded.recommendation.message}</Text>
              </View>
              {quiz.questions.map((q, i) => {
                const r = graded.results[i];
                return (
                  <View key={q.idx} style={styles.qBlock}>
                    <Text style={styles.qText}>{q.idx + 1}. {q.q}</Text>
                    {q.options.map((opt, oi) => {
                      const isAns = oi === r.answer, isYours = oi === r.your_answer;
                      return (
                        <View key={oi} style={[styles.opt, isAns && styles.optCorrect, isYours && !isAns && styles.optWrong]}>
                          <MaterialCommunityIcons name={isAns ? "check-circle" : isYours ? "close-circle" : "circle-outline"} size={16} color={isAns ? colors.success : isYours ? "#EB5757" : colors.onSurfaceTertiary} />
                          <Text style={styles.optText}>{opt}</Text>
                        </View>
                      );
                    })}
                    <Text style={styles.explain}>💡 {r.explanation}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {!graded ? (
            <Pressable testID="quiz-submit" style={[styles.submitBtn, !allAnswered && styles.disabled]} onPress={submit} disabled={!allAnswered || busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Check my understanding</Text>}
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {!graded.passed && <Pressable testID="quiz-retry" style={[styles.submitBtn, { flex: 1 }]} onPress={() => { setGraded(null); setAnswers({}); }}><Text style={styles.submitText}>Retake</Text></Pressable>}
              <Pressable testID="quiz-done" style={[styles.submitBtn, { flex: 1, backgroundColor: graded.passed ? colors.brandPrimary : colors.surfaceSecondary, borderColor: colors.border, borderWidth: graded.passed ? 0 : 1 }]} onPress={onClose}><Text style={[styles.submitText, !graded.passed && { color: colors.onSurface }]}>Done</Text></Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  hero: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  heroLabel: { color: colors.onBrandPrimary, opacity: 0.85, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  heroValue: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 40 },
  heroOf: { fontSize: 22, opacity: 0.7 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 11 },
  mentorCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  mentorOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  mentorTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  mentorSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  iconWrap: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  qTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  level: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  levelText: { fontFamily: font.bold, fontSize: 10 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  leaderMe: { borderColor: colors.brandPrimary },
  rank: { color: colors.onSurfaceTertiary, fontFamily: font.display, fontSize: type.base, width: 22 },
  leaderName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  leaderBadges: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginLeft: 3 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  qBlock: { marginBottom: spacing.lg },
  qText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.sm, lineHeight: 21 },
  opt: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xs },
  optOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
  optCorrect: { borderColor: colors.success, backgroundColor: colors.success + "14" },
  optWrong: { borderColor: "#EB5757", backgroundColor: "#EB575714" },
  optText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  radio: { width: 20, height: 20, borderRadius: 10, borderColor: colors.border, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: colors.brandPrimary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  explain: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs, lineHeight: 17 },
  scoreCard: { alignItems: "center", borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, gap: 4 },
  scoreVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 36 },
  scoreMsg: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, textAlign: "center" },
  footer: { paddingTop: spacing.md, marginTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  disabled: { opacity: 0.4 },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
