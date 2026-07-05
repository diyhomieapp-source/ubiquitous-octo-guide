import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Track = { slug: string; title: string; level: string; status: string; lesson_count: number };
type Lesson = { id: string; track_slug: string; title: string; order: number; status: string; version: number; est_minutes: number };
type Analytics = { total_tracks: number; total_lessons: number; completions: number; learners: number; by_track: { track: string; completions: number }[] };

export function EducationModule() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, a] = await Promise.all([api<{ tracks: Track[]; lessons: Lesson[] }>("/admin/education"), api<Analytics>("/admin/education/analytics")]);
      setTracks(l.tracks); setLessons(l.lessons); setAnalytics(a);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: string) => {
    try { await api(`/admin/education/lessons/${id}/toggle`, { method: "POST" }); load(); } catch {}
  };

  if (loading || !analytics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const maxT = Math.max(1, ...analytics.by_track.map((t) => t.completions));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Education Center</Text>
      <Text style={styles.sub}>Curriculum tracks, lessons & learning analytics — no-code, version-controlled.</Text>

      <View style={styles.statRow}>
        <Stat label="Tracks" value={String(analytics.total_tracks)} />
        <Stat label="Lessons" value={String(analytics.total_lessons)} />
        <Stat label="Completions" value={String(analytics.completions)} />
        <Stat label="Learners" value={String(analytics.learners)} />
      </View>

      <Text style={styles.section}>Completions by track</Text>
      {analytics.by_track.length === 0 ? <Text style={styles.help}>No lesson completions yet.</Text> :
        analytics.by_track.map((t) => (
          <View key={t.track} style={styles.barRow}>
            <Text style={styles.barLabel}>{t.track}</Text>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(t.completions / maxT * 100)}%` }]} /></View>
            <Text style={styles.barCount}>{t.completions}</Text>
          </View>
        ))}

      {tracks.map((tr) => (
        <View key={tr.slug} style={{ marginTop: spacing.md }}>
          <Text style={styles.trackHead}>{tr.title} <Text style={styles.trackLvl}>· {tr.level} · {tr.lesson_count} lessons</Text></Text>
          {lessons.filter((l) => l.track_slug === tr.slug).map((l) => (
            <View key={l.id} testID="edu-admin-lesson" style={styles.lessonRow}>
              <MaterialCommunityIcons name={l.status === "published" ? "eye-outline" : "eye-off-outline"} size={18} color={l.status === "published" ? colors.success : colors.onSurfaceTertiary} />
              <View style={{ flex: 1 }}><Text style={styles.lessonTitle}>{l.order}. {l.title}</Text><Text style={styles.lessonMeta}>v{l.version} · {l.est_minutes} min · {l.status}</Text></View>
              <Pressable testID={`edu-toggle-${l.id}`} style={styles.miniBtn} onPress={() => toggle(l.id)}>
                <Text style={styles.miniText}>{l.status === "published" ? "Unpublish" : "Publish"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  barLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, width: 100 },
  track: { flex: 1, height: 16, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 16, borderRadius: radius.sm, backgroundColor: colors.brandPrimary },
  barCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, width: 36, textAlign: "right" },
  trackHead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.xs },
  trackLvl: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, textTransform: "capitalize" },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  lessonTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  lessonMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  miniBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  miniText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
});
