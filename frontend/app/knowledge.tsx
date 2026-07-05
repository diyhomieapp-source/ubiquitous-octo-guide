import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Guide = { id: string; title: string; category: string; summary: string; author_name: string; author_type: string; views: number; rating: number; rating_count: number };
type Detail = Guide & { body: string; steps: string[]; safety: string[] };
type Mentor = { name: string; type: string; specialty: string; badge: string; credits: number };

export default function Knowledge() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"guides" | "mentors">("guides");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, m] = await Promise.all([
        api<{ guides: Guide[]; categories: string[] }>("/knowledge"),
        api<{ mentors: Mentor[] }>("/knowledge/mentors"),
      ]);
      setGuides(g.guides); setCats(["All", ...g.categories]); setMentors(m.mentors);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = guides.filter((g) => (cat === "All" || g.category === cat) && (!q || (g.title + g.summary).toLowerCase().includes(q.toLowerCase())));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="knowledge-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Expert Knowledge</Text>
        <Pressable testID="knowledge-become" hitSlop={10} onPress={() => router.push("/expert")}><MaterialCommunityIcons name="account-plus-outline" size={22} color={colors.brandPrimary} /></Pressable>
      </View>
      <View style={styles.tabRow}>
        <Pressable testID="kn-tab-guides" style={[styles.tab, tab === "guides" && styles.tabOn]} onPress={() => setTab("guides")}><Text style={[styles.tabText, tab === "guides" && styles.tabTextOn]}>Pro Guides</Text></Pressable>
        <Pressable testID="kn-tab-mentors" style={[styles.tab, tab === "mentors" && styles.tabOn]} onPress={() => setTab("mentors")}><Text style={[styles.tabText, tab === "mentors" && styles.tabTextOn]}>Mentors</Text></Pressable>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {tab === "guides" ? (
            <>
              <View style={styles.searchRow}>
                <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceTertiary} />
                <TextInput testID="knowledge-search" style={styles.search} value={q} onChangeText={setQ} placeholder="Search pro guides…" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {cats.map((c) => <Pressable key={c} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}><Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
              </ScrollView>
              {filtered.length === 0 && <Text style={styles.empty}>No expert guides yet. Tap the + to become a contributor!</Text>}
              {filtered.map((g) => (
                <Pressable key={g.id} testID={`guide-${g.id}`} style={styles.card} onPress={() => setOpen(g.id)}>
                  <Text style={styles.gTitle}>{g.title}</Text>
                  <Text style={styles.summary} numberOfLines={2}>{g.summary}</Text>
                  <View style={styles.metaRow}>
                    <MaterialCommunityIcons name="check-decagram" size={13} color={colors.brandPrimary} />
                    <Text style={styles.meta}>{g.author_name} · {g.author_type}</Text>
                    <View style={{ flex: 1 }} />
                    <MaterialCommunityIcons name="star" size={13} color={colors.warning} />
                    <Text style={styles.meta}>{g.rating || "—"} · {g.views} views</Text>
                  </View>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              {mentors.length === 0 && <Text style={styles.empty}>No verified mentors yet.</Text>}
              {mentors.map((m, i) => (
                <View key={i} style={styles.card}>
                  <View style={styles.mentorTop}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{m.name[0]?.toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gTitle}>{m.name}</Text>
                      <Text style={styles.meta}>{m.type} · {m.specialty}</Text>
                    </View>
                    <View style={styles.credits}><MaterialCommunityIcons name="medal" size={13} color={colors.brandPrimary} /><Text style={styles.creditsText}>{m.credits}</Text></View>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {open && <GuideModal guideId={open} onClose={() => setOpen(null)} onChange={load} />}
    </View>
  );
}

function GuideModal({ guideId, onClose, onChange }: { guideId: string; onClose: () => void; onChange: () => void }) {
  const insets = useSafeAreaInsets();
  const [g, setG] = useState<Detail | null>(null);
  const load = useCallback(async () => { try { setG(await api<Detail>(`/knowledge/${guideId}`)); } catch {} }, [guideId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rate = async (n: number) => { try { await api(`/knowledge/${guideId}/rate`, { method: "POST", body: { rating: n } }); Alert.alert("Thanks!", "Your rating helps other DIYers."); onChange(); } catch {} };
  const flag = async () => { try { await api(`/knowledge/${guideId}/flag`, { method: "POST", body: { reason: "Reported for review" } }); Alert.alert("Reported", "Our team will review this guide."); } catch {} };

  if (!g) return <View style={styles.overlay}><View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}><ActivityIndicator color={colors.brandPrimary} /></View></View>;
  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, maxHeight: "88%" }]}>
        <View style={styles.sheetHead}>
          <Text style={[styles.gTitle, { flex: 1 }]}>{g.title}</Text>
          <Pressable testID="guide-close" onPress={onClose} hitSlop={8}><MaterialCommunityIcons name="close" size={22} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={styles.meta}>{g.author_name} · {g.author_type} · {g.category}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          {!!g.summary && <Text style={styles.body}>{g.summary}</Text>}
          {!!g.body && <Text style={styles.body}>{g.body}</Text>}
          {g.steps.length > 0 && <Text style={styles.section}>Steps</Text>}
          {g.steps.map((s, i) => <Text key={i} style={styles.li}>{i + 1}. {s}</Text>)}
          {g.safety.length > 0 && <Text style={styles.section}>⚠️ Safety</Text>}
          {g.safety.map((s, i) => <Text key={i} style={styles.li}>• {s}</Text>)}
          <Text style={styles.section}>Rate this guide</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} testID={`guide-rate-${n}`} onPress={() => rate(n)}><MaterialCommunityIcons name="star-outline" size={30} color={colors.warning} /></Pressable>)}
          </View>
          <Pressable testID="guide-flag" style={styles.flagBtn} onPress={flag}><MaterialCommunityIcons name="flag-outline" size={15} color={colors.onSurfaceTertiary} /><Text style={styles.flagText}>Report an issue</Text></Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tabRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.onBrandPrimary },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, borderColor: colors.border, borderWidth: 1 },
  search: { flex: 1, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chipRow: { gap: spacing.xs, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  gTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  summary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl, lineHeight: 20 },
  mentorTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 18 },
  credits: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary + "18", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  creditsText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center" },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.md, marginBottom: spacing.xs },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: 2 },
  stars: { flexDirection: "row", gap: spacing.sm },
  flagBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.lg, alignSelf: "flex-start" },
  flagText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
