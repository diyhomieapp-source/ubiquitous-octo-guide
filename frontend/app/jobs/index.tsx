import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Job = { id: string; title: string; status: string; pro_name: string; proposal?: { total_cents: number } | null; updated_at: string };

const STATUS_COLOR: Record<string, string> = {
  proposal_sent: colors.info, approved: colors.brandPrimary, in_progress: colors.warning,
  completed: colors.success, cancelled: colors.error,
};
const STATUS_LABEL: Record<string, string> = {
  proposal_sent: "Review proposal", approved: "Approved", in_progress: "In progress",
  completed: "Completed", cancelled: "Cancelled",
};

export default function ClientJobs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setJobs(await api<Job[]>("/client/jobs")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cjobs-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My Pro Jobs</Text>
        <View style={{ width: 28 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {jobs.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="handshake-outline" size={38} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No pro jobs yet. When a contractor sends you a proposal, it'll appear here.</Text>
            </View>
          ) : jobs.map((j) => (
            <Pressable key={j.id} testID={`cjob-${j.id}`} style={styles.card} onPress={() => router.push(`/jobs/${j.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{j.title}</Text>
                <Text style={styles.meta}>{j.pro_name}{j.proposal ? ` · ${money(j.proposal.total_cents)}` : ""}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: (STATUS_COLOR[j.status] || colors.onSurfaceTertiary) + "22" }]}>
                <Text style={[styles.pillText, { color: STATUS_COLOR[j.status] || colors.onSurfaceTertiary }]}>{STATUS_LABEL[j.status] || j.status}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 10 },
});
