import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { UpgradeNudge } from "@/src/components/UpgradeNudge";

type Project = { id: string; title: string; project_category: string; status: string; risk_level?: string; created_at: string };
const STATUS_COLOR: Record<string, string> = { draft: colors.onSurfaceTertiary, active: colors.info, paused: colors.warning, completed: colors.success, unresolved: colors.warning, escalated: colors.error };
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "paused", label: "Paused", statuses: ["paused"] },
  { key: "planning", label: "Planning", statuses: ["draft", "planning"] },
  { key: "done", label: "Done", statuses: ["completed", "unresolved", "escalated"] },
];

export default function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [nextMap, setNextMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");

  const load = useCallback(async () => {
    try {
      const d = await api<{ projects: Project[] }>("/hi/projects");
      setProjects(d.projects);
      api<any>("/hi/workspace/now-summaries").then((s) => setNextMap(s.summaries || {})).catch(() => {});
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];
  const filtered = activeTab.statuses.length === 0 ? projects : projects.filter((p) => activeTab.statuses.includes(p.status));

  return (
    <View style={styles.root}>
      <ScreenHeader title="My Projects" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <UpgradeNudge feature="project" />
        <Pressable testID="proj-new" style={styles.newBtn} onPress={() => router.push("/home-intel/projects/start")}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.newText}>Start a Project</Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable key={t.key} testID={`proj-tab-${t.key}`} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && { color: colors.onBrandPrimary }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <MaterialCommunityIcons name="home-heart" size={40} color={colors.brandPrimary} />
              <Text style={styles.emptyTitle}>What would you like to improve?</Text>
              <Text style={styles.empty}>Tell Homie what you want to do, scan something that needs attention, or start a project manually.</Text>
              <View style={styles.emptyBtns}>
                <Pressable testID="proj-empty-homie" style={styles.emptyBtn} onPress={() => router.push("/home-intel/voice")}>
                  <MaterialCommunityIcons name="microphone-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.emptyBtnText}>Talk to Homie</Text>
                </Pressable>
                <Pressable testID="proj-empty-scan" style={styles.emptyBtn} onPress={() => router.push("/home-intel/record")}>
                  <MaterialCommunityIcons name="camera-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.emptyBtnText}>Scan a Problem</Text>
                </Pressable>
                <Pressable testID="proj-empty-new" style={styles.emptyBtn} onPress={() => router.push("/home-intel/projects/start")}>
                  <MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} />
                  <Text style={styles.emptyBtnText}>New Project</Text>
                </Pressable>
              </View>
            </View>
          ) :
          filtered.map((p) => (
            <Pressable key={p.id} testID={`proj-${p.id}`} style={styles.card} onPress={() => router.push(`/home-intel/projects/${p.id}`)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[p.status] || colors.info }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
                <Text style={styles.meta}>{p.project_category} · {p.status}{p.risk_level ? ` · ${p.risk_level}` : ""}</Text>
                {nextMap[p.id] ? <Text style={styles.next} numberOfLines={1}>Next: {nextMap[p.id]}</Text> : null}
              </View>
              {["active", "paused"].includes(p.status) ? (
                <View style={styles.resumeChip}><Text style={styles.resumeText}>{p.status === "paused" ? "Resume" : "Continue"}</Text></View>
              ) : (
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              )}
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  newText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  tabRow: { gap: spacing.xs, paddingBottom: spacing.md },
  tab: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  emptyWrap: { alignItems: "center", marginTop: spacing.xl, paddingHorizontal: spacing.md },
  emptyTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.sm, textAlign: "center" },
  emptyBtns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg, justifyContent: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.brandPrimary + "66", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  emptyBtnText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  next: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.xs, marginTop: 3 },
  resumeChip: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  resumeText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
});
