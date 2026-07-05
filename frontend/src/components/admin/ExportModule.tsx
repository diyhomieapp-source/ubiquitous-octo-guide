import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Kpis = Record<string, number>;
const LABELS: Record<string, string> = {
  users: "Users", projects: "Projects", project_completions: "Completions",
  active_certificates: "Active certs", lessons_completed: "Lessons done",
  campaigns: "Campaigns", campaign_completions: "Campaign wins",
  exports_generated: "Exports", audit_events: "Audit events", total_member_savings_usd: "Member savings ($)",
};

export function ExportModule() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, j] = await Promise.all([api<{ kpis: Kpis }>("/admin/export/kpis"), api<{ jobs: any[] }>("/admin/export/jobs")]);
      setKpis(k.kpis); setJobs(j.jobs);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const copyKpis = async () => {
    if (!kpis) return;
    await Clipboard.setStringAsync(JSON.stringify(kpis, null, 2));
    Alert.alert("Copied", "Platform KPIs copied as JSON — paste into your BI tool or board deck.");
  };

  if (loading || !kpis) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Data & Reporting Export</Text>
      <Text style={styles.sub}>Platform-wide KPIs and user export activity.</Text>

      <View style={styles.grid}>
        {Object.keys(kpis).map((k) => (
          <View key={k} style={styles.card}>
            <Text style={styles.val}>{k === "total_member_savings_usd" ? `$${Number(kpis[k]).toLocaleString()}` : kpis[k]}</Text>
            <Text style={styles.label}>{LABELS[k] || k}</Text>
          </View>
        ))}
      </View>

      <Pressable testID="export-copy-kpis" style={styles.btn} onPress={copyKpis}><Text style={styles.btnText}>Copy KPIs (JSON)</Text></Pressable>

      <Text style={styles.section}>Recent user exports ({jobs.length})</Text>
      {jobs.length === 0 ? <Text style={styles.help}>No exports generated yet.</Text> :
        jobs.map((j) => (
          <View key={j.token} style={styles.jobRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobUser}>{j.user_name}</Text>
              <Text style={styles.jobMeta}>{(j.types || []).join(", ")} · {j.format} · {(j.created_at || "").slice(0, 10)}</Text>
            </View>
            <Text style={styles.jobDl}>{j.download_count}/{j.max_downloads} dl</Text>
          </View>
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "31%", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  val: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2, textAlign: "center" },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  jobRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  jobUser: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  jobMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  jobDl: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.xs },
});
