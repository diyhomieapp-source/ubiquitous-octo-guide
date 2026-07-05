import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type App = { id: string; name: string; type: string; specialty: string; license: string; bio: string; status: string };
type Guide = { id: string; title: string; category: string; author_name: string; status: string; version: number; views: number; flag_count: number };
type Flagged = { id: string; title: string; status: string; flags: { reason: string; at: string }[] };

const S_COLOR: Record<string, string> = { pending: "#F2994A", approved: "#27AE60", rejected: "#EB5757", published: "#27AE60", draft: "#828282", obsolete: "#828282" };

export function ExpertsModule() {
  const [tab, setTab] = useState<"apps" | "guides" | "flags">("apps");
  const [apps, setApps] = useState<App[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [flags, setFlags] = useState<Flagged[]>([]);
  const [totals, setTotals] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [a, g, f, an] = await Promise.all([
        api<{ applications: App[] }>("/admin/experts"),
        api<{ guides: Guide[] }>("/admin/knowledge"),
        api<{ flagged: Flagged[] }>("/admin/knowledge/flags"),
        api<{ totals: any }>("/admin/experts/analytics"),
      ]);
      setApps(a.applications); setGuides(g.guides); setFlags(f.flagged); setTotals(an.totals);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reviewApp = async (id: string, decision: string) => { try { await api(`/admin/experts/${id}/review`, { method: "POST", body: { decision } }); load(); } catch {} };
  const reviewGuide = async (id: string, decision: string) => { try { await api(`/admin/knowledge/${id}/review`, { method: "POST", body: { decision } }); load(); } catch {} };
  const delGuide = async (id: string) => { try { await api(`/admin/knowledge/${id}`, { method: "DELETE" }); load(); } catch {} };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Experts & Knowledge</Text>
      <Text style={styles.sub}>Onboard verified pros, QA their guides, and govern the community knowledge base.</Text>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Applications" value={String(totals.applications)} />
          <Stat label="Pending" value={String(totals.pending)} />
          <Stat label="Approved" value={String(totals.approved)} />
          <Stat label="Published" value={String(totals.published)} />
          <Stat label="Flags" value={String(totals.flags)} />
        </View>
      )}

      <View style={styles.tabRow}>
        {([["apps", `Applications (${apps.filter((a) => a.status === "pending").length})`], ["guides", "Guide QA"], ["flags", `Flags (${flags.length})`]] as const).map(([k, lbl]) => (
          <Pressable key={k} testID={`experts-tab-${k}`} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k as any)}><Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{lbl}</Text></Pressable>
        ))}
      </View>

      {tab === "apps" && (
        <>
          {apps.length === 0 && <Text style={styles.empty}>No applications yet.</Text>}
          {apps.map((a) => (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={[styles.name, { flex: 1 }]}>{a.name}</Text>
                <View style={[styles.pill, { backgroundColor: (S_COLOR[a.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.pillText, { color: S_COLOR[a.status] || colors.onSurfaceTertiary }]}>{a.status.toUpperCase()}</Text></View>
              </View>
              <Text style={styles.meta}>{a.type} · {a.specialty}{a.license ? ` · ${a.license}` : ""}</Text>
              {!!a.bio && <Text style={styles.bio}>{a.bio}</Text>}
              {a.status === "pending" && (
                <View style={styles.actionRow}>
                  <Pressable testID={`app-approve-${a.id}`} style={[styles.btn, styles.btnOk]} onPress={() => reviewApp(a.id, "approve")}><Text style={styles.btnOkText}>Approve</Text></Pressable>
                  <Pressable testID={`app-reject-${a.id}`} style={styles.btn} onPress={() => reviewApp(a.id, "reject")}><Text style={styles.btnText}>Reject</Text></Pressable>
                </View>
              )}
            </View>
          ))}
        </>
      )}

      {tab === "guides" && (
        <>
          {guides.length === 0 && <Text style={styles.empty}>No guides submitted yet.</Text>}
          {guides.map((g) => (
            <View key={g.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={[styles.name, { flex: 1 }]}>{g.title}</Text>
                <View style={[styles.pill, { backgroundColor: (S_COLOR[g.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.pillText, { color: S_COLOR[g.status] || colors.onSurfaceTertiary }]}>{g.status.toUpperCase()}</Text></View>
              </View>
              <Text style={styles.meta}>{g.author_name} · {g.category} · v{g.version} · {g.views} views{g.flag_count ? ` · 🚩${g.flag_count}` : ""}</Text>
              <View style={styles.actionRow}>
                {g.status !== "published" && <Pressable testID={`guide-publish-${g.id}`} style={[styles.btn, styles.btnOk]} onPress={() => reviewGuide(g.id, "publish")}><Text style={styles.btnOkText}>Publish</Text></Pressable>}
                {g.status === "published" && <Pressable testID={`guide-obsolete-${g.id}`} style={styles.btn} onPress={() => reviewGuide(g.id, "obsolete")}><Text style={styles.btnText}>Mark obsolete</Text></Pressable>}
                {g.status !== "rejected" && <Pressable testID={`guide-reject-${g.id}`} style={styles.btn} onPress={() => reviewGuide(g.id, "reject")}><Text style={styles.btnText}>Reject</Text></Pressable>}
                <Pressable testID={`guide-del-${g.id}`} style={styles.btn} onPress={() => delGuide(g.id)}><MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.onSurfaceTertiary} /></Pressable>
              </View>
            </View>
          ))}
        </>
      )}

      {tab === "flags" && (
        <>
          {flags.length === 0 && <Text style={styles.empty}>No flagged content. 🎉</Text>}
          {flags.map((f) => (
            <View key={f.id} style={styles.card}>
              <Text style={styles.name}>{f.title}</Text>
              <Text style={styles.meta}>{f.status} · {f.flags.length} flag(s)</Text>
              {f.flags.slice(0, 4).map((fl, i) => <Text key={i} style={styles.bio}>🚩 {fl.reason}</Text>)}
              <View style={styles.actionRow}>
                <Pressable testID={`flag-obsolete-${f.id}`} style={styles.btn} onPress={() => reviewGuide(f.id, "obsolete")}><Text style={styles.btnText}>Mark obsolete</Text></Pressable>
                <Pressable testID={`flag-del-${f.id}`} style={styles.btn} onPress={() => delGuide(f.id)}><Text style={styles.btnText}>Delete</Text></Pressable>
              </View>
            </View>
          ))}
        </>
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
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 62, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  tabRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  bio: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md },
});
