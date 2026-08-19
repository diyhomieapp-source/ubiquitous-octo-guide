import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const MODE_META: Record<string, { label: string; icon: string; tone: string }> = {
  SPATIAL_AR: { label: "Spatial AR", icon: "cube-scan", tone: "#2D9CDB" },
  SURFACE_PATH: { label: "Surface & Path", icon: "gesture-swipe-right", tone: "#27AE60" },
  FINE_MOTOR: { label: "Fine-Motor", icon: "hand-back-right-outline", tone: "#BB6BD9" },
  ASSEMBLY: { label: "Assembly", icon: "toy-brick-outline", tone: "#F2994A" },
  MEASUREMENT_LAYOUT: { label: "Measure & Layout", icon: "ruler-square", tone: "#F2C94C" },
};

export default function GuideLibrary() {
  const router = useRouter();
  const [procs, setProcs] = useState<any[]>([]);
  const [openSessions, setOpenSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<any>("/hi/guide/procedures");
      setProcs(res.procedures || []);
      setOpenSessions(res.open_sessions || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.root}><ScreenHeader title="Show Me How" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const byId: Record<string, any> = {};
  procs.forEach((p) => { byId[p.id] = p; });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Show Me How" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.hero}>Visual, one-action-at-a-time guidance</Text>
        <Text style={styles.heroSub}>Homie shows you where, demonstrates how, and checks in before moving on — from walls to balloon animals.</Text>

        <Pressable testID="guide-assist-link" style={styles.assistLink} onPress={() => router.push("/home-intel/guide/assist")}>
          <MaterialCommunityIcons name="account-wrench-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.assistLinkText}>My assistance requests & saved demos</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
        </Pressable>

        {openSessions.length > 0 && (
          <View style={styles.resumeCard}>
            <MaterialCommunityIcons name="play-circle-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>Pick up where you left off</Text>
              {openSessions.map((s) => (
                <Pressable key={s.id} testID={`guide-resume-${s.procedure_id}`} style={styles.resumeRow} onPress={() => router.push(`/home-intel/guide/${s.procedure_id}`)}>
                  <Text style={styles.resumeName}>{byId[s.procedure_id]?.title || s.procedure_id}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {procs.map((p) => {
          const m = MODE_META[p.primary_mode] || MODE_META.SPATIAL_AR;
          return (
            <Pressable key={p.id} testID={`guide-proc-${p.id}`} style={styles.card} onPress={() => router.push(`/home-intel/guide/${p.id}`)}>
              <View style={[styles.iconWrap, { backgroundColor: m.tone + "22" }]}>
                <MaterialCommunityIcons name={m.icon as any} size={24} color={m.tone} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.title}</Text>
                <Text style={styles.cardDesc}>{p.description}</Text>
                <View style={styles.metaRow}>
                  <View style={[styles.badge, { borderColor: m.tone + "66" }]}><Text style={[styles.badgeText, { color: m.tone }]}>{m.label}</Text></View>
                  <Text style={styles.meta}>{p.step_count} steps · ~{p.est_minutes} min · {p.difficulty}</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
            </Pressable>
          );
        })}

        <View style={styles.legend}>
          <Text style={styles.legendTitle}>How guidance works</Text>
          <Text style={styles.legendLine}>• Green — correct target or done · Yellow — needs your attention</Text>
          <Text style={styles.legendLine}>• Red — keep-out zone · Blue — recommended movement path</Text>
          <Text style={styles.legendLine}>• Ghost hands & tools demonstrate the exact motion</Text>
          <Text style={styles.legendLine}>• You confirm every step — nothing advances without you</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { ...type.heading, color: colors.onSurface, marginBottom: spacing.xs },
  heroSub: { ...type.body, color: colors.onSurfaceTertiary, marginBottom: spacing.lg },
  assistLink: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, minHeight: 48 },
  assistLinkText: { ...type.body, color: colors.brandPrimary, flex: 1 },
  resumeCard: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.brandPrimary + "14", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  resumeTitle: { ...type.button, color: colors.brandPrimary, marginBottom: spacing.xs },
  resumeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs, minHeight: 44 },
  resumeName: { ...type.body, color: colors.onSurface },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  iconWrap: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...type.button, fontSize: 16, color: colors.onSurface },
  cardDesc: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs, flexWrap: "wrap" },
  badge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...type.caption, fontSize: 11 },
  meta: { ...type.caption, color: colors.onSurfaceTertiary },
  legend: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  legendTitle: { ...type.button, color: colors.onSurface, marginBottom: spacing.xs },
  legendLine: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 2 },
});
