import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Project = { id: string; title: string; project_category: string; status: string; risk_level?: string; created_at: string };
const STATUS_COLOR: Record<string, string> = { draft: colors.onSurfaceTertiary, active: colors.info, paused: colors.warning, completed: colors.success, unresolved: colors.warning, escalated: colors.error };

export default function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api<{ projects: Project[] }>("/hi/projects"); setProjects(d.projects); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="My Projects" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Pressable testID="proj-new" style={styles.newBtn} onPress={() => router.push("/home-intel/projects/start")}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.newText}>Start a Project</Text>
        </Pressable>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          projects.length === 0 ? <Text style={styles.empty}>No projects yet. Describe what you&apos;d like to fix, build, or improve.</Text> :
          projects.map((p) => (
            <Pressable key={p.id} testID={`proj-${p.id}`} style={styles.card} onPress={() => router.push(`/home-intel/projects/${p.id}`)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[p.status] || colors.info }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
                <Text style={styles.meta}>{p.project_category} · {p.status}{p.risk_level ? ` · ${p.risk_level}` : ""}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  newText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.lg },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
