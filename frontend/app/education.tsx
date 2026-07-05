import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Progress = { total: number; completed: number; pct: number };
type Track = { slug: string; title: string; level: string; category: string; icon: string; summary: string; progress: Progress };
type Lesson = { id: string; title: string; order: number; level: string; est_minutes: number; summary: string; sections: string[]; flashcards: { term: string; def: string }[]; tools: string[]; safety: string[]; quiz_id: string | null; completed: boolean };
type Me = { completed_count: number; badges: number; suggested: { id: string; title: string; track_slug: string; level: string; est_minutes: number }[] };

export default function Education() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTrack, setOpenTrack] = useState<{ track: Track; lessons: Lesson[] } | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([api<{ tracks: Track[] }>("/education/tracks"), api<Me>("/education/me")]);
      setTracks(t.tracks); setMe(m);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openTrackDetail = async (slug: string) => {
    try { setOpenTrack(await api<{ track: Track; lessons: Lesson[] }>(`/education/tracks/${slug}`)); }
    catch {}
  };
  const openLesson = async (id: string) => {
    try { setLesson(await api<Lesson>(`/education/lessons/${id}`)); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
    catch {}
  };
  const completeLesson = async () => {
    if (!lesson) return;
    setBusy(true);
    try {
      const r = await api<{ quiz_id: string | null; next_lesson: Lesson | null }>(`/education/lessons/${lesson.id}/complete`, { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const quizId = r.quiz_id;
      setLesson(null);
      if (openTrack) await openTrackDetail(openTrack.track.slug);
      await load();
      if (quizId) router.push(`/skills?quizId=${quizId}`);
    } catch {} finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="edu-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Learn to DIY</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {me && (
            <View style={styles.dash}>
              <View style={styles.dashStat}><Text style={styles.dashVal}>{me.completed_count}</Text><Text style={styles.dashLabel}>Lessons done</Text></View>
              <View style={styles.dashStat}><Text style={styles.dashVal}>{me.badges}</Text><Text style={styles.dashLabel}>Skill badges</Text></View>
              <View style={styles.dashStat}><Text style={styles.dashVal}>{tracks.length}</Text><Text style={styles.dashLabel}>Tracks</Text></View>
            </View>
          )}

          {me && me.suggested.length > 0 && (
            <>
              <Text style={styles.section}>Recommended for you</Text>
              {me.suggested.map((s) => (
                <Pressable key={s.id} testID={`edu-suggested-${s.id}`} style={styles.sugRow} onPress={() => openLesson(s.id)}>
                  <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={colors.brandPrimary} />
                  <View style={{ flex: 1 }}><Text style={styles.sugTitle} numberOfLines={1}>{s.title}</Text><Text style={styles.sugMeta}>{s.level} · {s.est_minutes} min</Text></View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </>
          )}

          <Text style={styles.section}>Curriculum tracks</Text>
          {tracks.map((t) => (
            <Pressable key={t.slug} testID={`edu-track-${t.slug}`} style={styles.trackCard} onPress={() => openTrackDetail(t.slug)}>
              <View style={styles.trackIcon}><MaterialCommunityIcons name={t.icon as any} size={22} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackTitle}>{t.title}</Text>
                <Text style={styles.trackSum} numberOfLines={2}>{t.summary}</Text>
                <View style={styles.trackBar}><View style={[styles.trackFill, { width: `${t.progress.pct}%` }]} /></View>
                <Text style={styles.trackProg}>{t.progress.completed}/{t.progress.total} lessons · {t.level}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* track detail modal */}
      <Modal visible={!!openTrack && !lesson} animationType="slide" transparent onRequestClose={() => setOpenTrack(null)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{openTrack?.track.title}</Text>
              <Pressable testID="edu-track-close" hitSlop={10} onPress={() => setOpenTrack(null)}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView>
              {openTrack?.lessons.map((l) => (
                <Pressable key={l.id} testID={`edu-lesson-${l.id}`} style={styles.lessonRow} onPress={() => openLesson(l.id)}>
                  <MaterialCommunityIcons name={l.completed ? "check-circle" : "circle-outline"} size={22} color={l.completed ? colors.success : colors.onSurfaceTertiary} />
                  <View style={{ flex: 1 }}><Text style={styles.lessonTitle}>{l.title}</Text><Text style={styles.lessonMeta}>{l.est_minutes} min · {l.level}</Text></View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* lesson reader modal */}
      <Modal visible={!!lesson} animationType="slide" transparent onRequestClose={() => setLesson(null)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { maxHeight: "88%", paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{lesson?.title}</Text>
              <Pressable testID="edu-lesson-close" hitSlop={10} onPress={() => setLesson(null)}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView>
              <Text style={styles.lessonSummary}>{lesson?.summary}</Text>
              <Text style={styles.blockLabel}>Steps</Text>
              {lesson?.sections.map((s, i) => (
                <View key={i} style={styles.stepRow}><Text style={styles.stepNum}>{i + 1}</Text><Text style={styles.stepText}>{s}</Text></View>
              ))}
              {!!lesson?.flashcards.length && (
                <>
                  <Text style={styles.blockLabel}>Flashcards</Text>
                  {lesson.flashcards.map((f, i) => (
                    <View key={i} style={styles.flash}><Text style={styles.flashTerm}>{f.term}</Text><Text style={styles.flashDef}>{f.def}</Text></View>
                  ))}
                </>
              )}
              {!!lesson?.safety.length && (
                <View style={styles.safety}>
                  <MaterialCommunityIcons name="shield-alert-outline" size={16} color={colors.warning} />
                  <Text style={styles.safetyText}>{lesson.safety.join(" · ")}</Text>
                </View>
              )}
            </ScrollView>
            <Pressable testID="edu-complete" style={[styles.completeBtn, lesson?.completed && { backgroundColor: colors.success }]} onPress={completeLesson} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.completeText}>{lesson?.completed ? "Completed ✓ — mark again" : lesson?.quiz_id ? "Complete & take the quiz" : "Mark lesson complete"}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  dash: { flexDirection: "row", gap: spacing.sm },
  dashStat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  dashVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 22 },
  dashLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  sugRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  sugTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  sugMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  trackCard: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  trackIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  trackTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  trackSum: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  trackBar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginTop: spacing.sm },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  trackProg: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 4, textTransform: "capitalize" },
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "80%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sheetTitle: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  lessonTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  lessonMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  lessonSummary: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md, lineHeight: 20 },
  blockLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  stepRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, color: colors.onBrandPrimary, textAlign: "center", lineHeight: 22, fontFamily: font.bold, fontSize: 12 },
  stepText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  flash: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  flashTerm: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  flashDef: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  safety: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  safetyText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  completeBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  completeText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
