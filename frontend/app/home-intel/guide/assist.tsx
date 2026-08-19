import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_META: Record<string, { label: string; tone: string; icon: string }> = {
  submitted: { label: "Submitted", tone: "#2D9CDB", icon: "send-clock-outline" },
  matched: { label: "Matched", tone: "#BB6BD9", icon: "account-check-outline" },
  in_progress: { label: "In Progress", tone: "#F2994A", icon: "progress-wrench" },
  completed: { label: "Completed", tone: "#27AE60", icon: "check-circle-outline" },
  cancelled: { label: "Cancelled", tone: "#888", icon: "cancel" },
};
const TYPE_LABEL: Record<string, string> = {
  quick_question: "Quick Question", remote_review: "Remote Review", live_video: "Live Video Help",
  design_review: "Design Review", get_quotes: "Get Quotes", hire_pro: "Hire a Pro",
};

export default function AssistStatus() {
  const [tab, setTab] = useState<"requests" | "saved">("requests");
  const [requests, setRequests] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api<any>("/hi/proconnect/requests"), api<any>("/hi/proconnect/saved")]);
      setRequests(r.requests || []);
      setSaved(s.demos || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = (id: string) => {
    Alert.alert("Cancel request?", "The professional won't receive it.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel request", style: "destructive", onPress: async () => { try { await api(`/hi/proconnect/requests/${id}/cancel`, { method: "POST" }); load(); } catch {} } },
    ]);
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Assistance & Saved" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Assistance & Saved" />
      <View style={styles.tabs}>
        <Pressable testID="assist-tab-requests" style={[styles.tab, tab === "requests" && styles.tabActive]} onPress={() => setTab("requests")}>
          <Text style={[styles.tabText, tab === "requests" && styles.tabTextActive]}>My Requests</Text>
        </Pressable>
        <Pressable testID="assist-tab-saved" style={[styles.tab, tab === "saved" && styles.tabActive]} onPress={() => setTab("saved")}>
          <Text style={[styles.tabText, tab === "saved" && styles.tabTextActive]}>Saved Demos</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        {tab === "requests" && (requests.length === 0 ? (
          <Text style={styles.empty}>No assistance requests yet. Tap &ldquo;Bring In a Pro&rdquo; inside any guided project when you want help.</Text>
        ) : requests.map((r) => {
          const m = STATUS_META[r.status] || STATUS_META.submitted;
          return (
            <View key={r.id} style={styles.card}>
              <View style={styles.cardHead}>
                <MaterialCommunityIcons name={m.icon as any} size={20} color={m.tone} />
                <Text style={[styles.status, { color: m.tone }]}>{m.label}</Text>
                <Text style={styles.date}>{String(r.created_at).slice(0, 10)}</Text>
              </View>
              <Text style={styles.cardTitle}>{r.project_name}</Text>
              <Text style={styles.cardMeta}>{TYPE_LABEL[r.assistance_type] || r.assistance_type}{r.pro_name ? ` · ${r.pro_name}` : ""}</Text>
              {r.notes ? <Text style={styles.notes}>{r.notes}</Text> : null}
              {["submitted", "matched"].includes(r.status) && (
                <Pressable testID={`assist-cancel-${r.id}`} style={styles.cancelBtn} onPress={() => cancel(r.id)}>
                  <Text style={styles.cancelText}>Cancel request</Text>
                </Pressable>
              )}
            </View>
          );
        }))}
        {tab === "saved" && (saved.length === 0 ? (
          <Text style={styles.empty}>No saved demonstrations. Tap &ldquo;Save&rdquo; on any &ldquo;Watch a Pro&rdquo; clip to keep it here.</Text>
        ) : saved.map((d) => (
          <View key={d.id} style={styles.card}>
            <Text style={styles.cardTitle}>{d.title}</Text>
            <Text style={styles.cardMeta}>{d.creator?.channel_name} · {d.creator?.trade} · {Math.round(d.duration_sec / 6) / 10} min</Text>
            <Text style={styles.notes}>{d.source_attribution}</Text>
          </View>
        )))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, minHeight: 40, justifyContent: "center" },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { ...type.button, fontSize: 13, color: colors.onSurfaceTertiary },
  tabTextActive: { color: colors.onBrandPrimary },
  empty: { ...type.body, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.xl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xs },
  status: { ...type.button, fontSize: 13, flex: 1 },
  date: { ...type.caption, color: colors.onSurfaceTertiary },
  cardTitle: { ...type.button, fontSize: 15, color: colors.onSurface },
  cardMeta: { ...type.caption, color: colors.onSurfaceSecondary, marginTop: 2 },
  notes: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  cancelBtn: { alignSelf: "flex-start", marginTop: spacing.sm, minHeight: 44, justifyContent: "center" },
  cancelText: { ...type.caption, color: colors.error },
});
