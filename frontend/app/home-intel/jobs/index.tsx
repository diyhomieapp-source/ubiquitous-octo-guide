import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Job = { id: string; title: string; status: string; created_at: string; safety_status?: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", seeking_professional: "Seeking pro", contacted: "Contacted",
  scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", closed: "Closed",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "#888", seeking_professional: "#2F80ED", contacted: "#9B51E0",
  scheduled: "#F2994A", in_progress: "#FF6A00", completed: "#27AE60", closed: "#888",
};

export default function JobsList() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api<{ jobs: Job[] }>("/hi/jobs"); setJobs(d.jobs); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Contact a Pro" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.blurb}>When a job is beyond safe DIY, DIYhomie helps you organise the details and share a clear summary with a professional. We don&apos;t take payments or refer contractors.</Text>
        <Pressable testID="job-new" style={styles.newBtn} onPress={() => router.push("/home-intel/jobs/recommended")}>
          <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.newBtnText}>New job summary</Text>
        </Pressable>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          jobs.length === 0 ? <Text style={styles.empty}>No job summaries yet.</Text> :
            jobs.map((j) => (
              <Pressable key={j.id} testID={`job-${j.id}`} style={styles.card} onPress={() => router.push(`/home-intel/jobs/${j.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{j.title}</Text>
                  <Text style={styles.cardMeta}>{(j.created_at || "").slice(0, 10)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[j.status] || "#888") + "22", borderColor: STATUS_COLOR[j.status] || "#888" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[j.status] || "#888" }]}>{STATUS_LABEL[j.status] || j.status}</Text>
                </View>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  blurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.md },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  newBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.lg, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { fontFamily: font.bold, fontSize: type.sm },
});
