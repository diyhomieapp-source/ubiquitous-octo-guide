import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Campaign = { id: string; slug: string; title: string; sponsor_name: string; status: string; participants: number; completions: number; reward: { badge: string } };
type Funnel = { id: string; title: string; completed: number };
type Analytics = { campaign: { title: string; sponsor_name: string; status: string }; joined: number; completed: number; completion_rate: number; story_optins: number; milestone_funnel: Funnel[]; stories: { story: string }[]; cta_clicks: number; feedback_count: number; avg_rating: number | null; learned_pct: number; comments: { comment: string; rating: number }[] };

export function CampaignsModule() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Analytics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCampaigns((await api<{ campaigns: Campaign[] }>("/admin/campaigns")).campaigns); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAnalytics = async (id: string) => {
    try { setSel(await api<Analytics>(`/admin/campaigns/${id}/analytics`)); } catch {}
  };
  const toggle = async (id: string) => {
    try { await api(`/admin/campaigns/${id}/toggle`, { method: "POST" }); load(); } catch {}
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Sponsored Campaigns</Text>
      <Text style={styles.sub}>Brand challenges, participation & partner impact analytics.</Text>

      {campaigns.map((c) => (
        <View key={c.id} testID="camp-admin-row" style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{c.title}</Text>
            <Text style={styles.meta}>{c.sponsor_name} · {c.status} · {c.participants} joined · {c.completions} done</Text>
            <Text style={styles.reward}>Reward: {c.reward?.badge}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Pressable testID={`camp-analytics-${c.id}`} style={styles.miniBtn} onPress={() => openAnalytics(c.id)}><Text style={styles.miniText}>Analytics</Text></Pressable>
            <Pressable testID={`camp-toggle-${c.id}`} style={[styles.miniBtn, c.status === "active" && styles.dim]} onPress={() => toggle(c.id)}><Text style={styles.miniText}>{c.status === "active" ? "End" : "Activate"}</Text></Pressable>
          </View>
        </View>
      ))}

      {sel && (
        <View style={styles.analyticsBox}>
          <Text style={styles.aTitle}>{sel.campaign.title} — {sel.campaign.sponsor_name}</Text>
          <View style={styles.statRow}>
            <Stat label="Joined" value={String(sel.joined)} />
            <Stat label="Completed" value={String(sel.completed)} />
            <Stat label="Completion" value={`${sel.completion_rate}%`} />
            <Stat label="Story opt-ins" value={String(sel.story_optins)} />
            <Stat label="CTA clicks" value={String(sel.cta_clicks)} />
            <Stat label="Avg rating" value={sel.avg_rating != null ? `${sel.avg_rating}★` : "—"} />
            <Stat label="Learned" value={`${sel.learned_pct}%`} />
          </View>
          <Text style={styles.block}>Milestone funnel</Text>
          {sel.milestone_funnel.map((m) => (
            <View key={m.id} style={styles.funnelRow}><Text style={styles.funnelLabel} numberOfLines={1}>{m.title}</Text><Text style={styles.funnelCount}>{m.completed}</Text></View>
          ))}
          {sel.stories.length > 0 && (
            <>
              <Text style={styles.block}>Consented stories ({sel.stories.length})</Text>
              {sel.stories.map((s, i) => <Text key={i} style={styles.story}>“{s.story}”</Text>)}
            </>
          )}
        </View>
      )}
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
  card: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  reward: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  miniBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, minWidth: 74, alignItems: "center" },
  dim: { borderColor: colors.error },
  miniText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
  analyticsBox: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  aTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  block: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  funnelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  funnelLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  funnelCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginLeft: spacing.sm },
  story: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", marginBottom: 4 },
});
