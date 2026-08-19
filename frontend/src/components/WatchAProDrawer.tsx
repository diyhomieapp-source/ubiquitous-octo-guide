import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";

const LABELS: Record<string, { text: string; tone: string }> = {
  professional_demonstration: { text: "Professional Demonstration", tone: "#27AE60" },
  creator_demonstration: { text: "Creator Demonstration", tone: "#BB6BD9" },
  diyhomie_demonstration: { text: "DIYhomie Demonstration", tone: "#FF5A00" },
  community_submission: { text: "Community Submission", tone: "#888" },
};

export function WatchAProDrawer({ visible, onClose, procedureId, stepId }: {
  visible: boolean; onClose: () => void; procedureId: string; stepId?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [demos, setDemos] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = `procedure_id=${procedureId}${stepId ? `&step_id=${stepId}` : ""}`;
      const res = await api<any>(`/hi/proconnect/support?${q}`);
      setDemos(res.demos || []);
      setInsights(res.insights || []);
      (res.insights || []).forEach((i: any) => { api(`/hi/proconnect/insights/${i.id}/open`, { method: "POST" }).catch(() => {}); });
    } catch {} finally { setLoading(false); }
  }, [procedureId, stepId]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const watch = async (d: any) => {
    try {
      const r = await api<any>(`/hi/proconnect/demos/${d.id}/view`, { method: "POST" });
      Alert.alert(d.title, `${Math.round(d.duration_sec / 60 * 10) / 10} min · ${d.creator?.channel_name}\n\n${r.note}`);
    } catch {}
  };
  const toggleSave = async (d: any) => {
    try {
      const r = await api<any>(`/hi/proconnect/demos/${d.id}/save`, { method: "POST" });
      setDemos((prev) => prev.map((x) => (x.id === d.id ? { ...x, saved: r.saved } : x)));
    } catch {}
  };
  const toggleFollow = async (d: any) => {
    try {
      const r = await api<any>(`/hi/proconnect/creators/${d.creator_id}/follow`, { method: "POST" });
      setDemos((prev) => prev.map((x) => (x.creator_id === d.creator_id ? { ...x, following_creator: r.following } : x)));
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>Watch a Pro</Text>
            <Pressable testID="wap-close" onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>
          {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.xl }} /> : (
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
              {insights.map((i) => (
                <View key={i.id} style={styles.insightCard}>
                  <MaterialCommunityIcons name="certificate-outline" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.insightLabel}>Professional Insight</Text>
                    <Text style={styles.insightAttribution}>{i.attribution}</Text>
                    <Text style={styles.insightQuote}>&ldquo;{i.quote}&rdquo;</Text>
                  </View>
                </View>
              ))}
              {demos.length === 0 && insights.length === 0 && (
                <Text style={styles.empty}>No demonstrations for this step yet — your written and voice guidance covers everything you need.</Text>
              )}
              {demos.map((d) => {
                const lb = LABELS[d.label] || LABELS.community_submission;
                return (
                  <View key={d.id} style={styles.demoCard}>
                    <View style={[styles.labelChip, { borderColor: lb.tone + "88" }]}>
                      <Text style={[styles.labelText, { color: lb.tone }]}>{lb.text}</Text>
                    </View>
                    <Text style={styles.demoTitle}>{d.title}</Text>
                    <Pressable testID={`wap-creator-${d.creator_id}`} onPress={() => { onClose(); router.push(`/home-intel/guide/creator/${d.creator_id}`); }}>
                      <Text style={styles.demoMeta}>{d.creator?.channel_name} · {d.creator?.trade} · {Math.round(d.duration_sec / 6) / 10} min · {d.skill_level}</Text>
                    </Pressable>
                    <Text style={styles.attribution}>{d.source_attribution}</Text>
                    <View style={styles.actionsRow}>
                      <Pressable testID={`wap-watch-${d.id}`} style={styles.watchBtn} onPress={() => watch(d)}>
                        <MaterialCommunityIcons name="play" size={16} color={colors.onBrandPrimary} />
                        <Text style={styles.watchText}>Watch</Text>
                      </Pressable>
                      <Pressable testID={`wap-save-${d.id}`} style={styles.iconBtn} onPress={() => toggleSave(d)}>
                        <MaterialCommunityIcons name={d.saved ? "bookmark" : "bookmark-outline"} size={18} color={d.saved ? colors.brandPrimary : colors.onSurfaceTertiary} />
                        <Text style={styles.iconBtnText}>{d.saved ? "Saved" : "Save"}</Text>
                      </Pressable>
                      <Pressable testID={`wap-follow-${d.id}`} style={styles.iconBtn} onPress={() => toggleFollow(d)}>
                        <MaterialCommunityIcons name={d.following_creator ? "account-check" : "account-plus-outline"} size={18} color={d.following_creator ? colors.success : colors.onSurfaceTertiary} />
                        <Text style={styles.iconBtnText}>{d.following_creator ? "Following" : "Follow"}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <Pressable testID="wap-return" style={styles.returnBtn} onPress={onClose}>
                <MaterialCommunityIcons name="arrow-left" size={18} color={colors.onSurface} />
                <Text style={styles.returnText}>Return to Guidance</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "85%" },
  handleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { ...type.heading, color: colors.onSurface },
  insightCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.warning + "12", borderColor: colors.warning + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  insightLabel: { ...type.caption, fontSize: 10, color: colors.warning, textTransform: "uppercase", letterSpacing: 0.5 },
  insightAttribution: { ...type.button, fontSize: 13, color: colors.onSurface, marginTop: 2 },
  insightQuote: { ...type.body, color: colors.onSurfaceSecondary, marginTop: spacing.xs, fontStyle: "italic" },
  empty: { ...type.body, color: colors.onSurfaceTertiary, textAlign: "center", marginVertical: spacing.lg },
  demoCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  labelChip: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs },
  labelText: { ...type.caption, fontSize: 10 },
  demoTitle: { ...type.button, fontSize: 15, color: colors.onSurface },
  demoMeta: { ...type.caption, color: colors.brandPrimary, marginTop: 2 },
  attribution: { ...type.caption, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 2 },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, alignItems: "center" },
  watchBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 40 },
  watchText: { ...type.button, fontSize: 13, color: colors.onBrandPrimary },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, minHeight: 40 },
  iconBtnText: { ...type.caption, color: colors.onSurfaceSecondary },
  returnBtn: { flexDirection: "row", gap: spacing.xs, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.surfaceTertiary, borderRadius: radius.md, paddingVertical: spacing.md, minHeight: 48 },
  returnText: { ...type.button, color: colors.onSurface },
});
