import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const SEV_COLOR: Record<string, string> = { critical: "#EB5757", high: "#EB5757", medium: "#F2994A", low: "#2F80ED", info: "#888" };
const CONN_COLOR: Record<string, string> = { connected: "#27AE60", dormant: "#F2994A", down: "#EB5757" };

export function HomieHqModule() {
  const [dash, setDash] = useState<any>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [ai, setAi] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a, c] = await Promise.all([
        api<any>("/hi/admin/hq/dashboard"),
        api<any>("/hi/admin/hq/approvals"),
        api<any>("/hi/admin/hq/ai-costs"),
      ]);
      setDash(d); setApprovals(a.approvals || []); setAi(c);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async (aid: string, decision: string) => {
    setBusy(true);
    try { await api(`/hi/admin/hq/approvals/${aid}/decide`, { method: "POST", body: { decision } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't decide", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const alertAction = async (id: string, action: string) => {
    setBusy(true);
    try { await api(`/hi/admin/hq/alerts/${id}/${action}`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const dom = dash.domains; const att = dash.attention;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Homie HQ</Text>
          <Text style={styles.sub}>What needs attention today?</Text>
        </View>
        <Pressable testID="hq-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Open alerts" value={dash.summary.open_alerts} accent={dash.summary.open_alerts > 0} />
        <Stat label="Approvals" value={dash.summary.pending_approvals} accent={dash.summary.pending_approvals > 0} />
        <Stat label="New insights" value={dash.summary.new_insights} />
      </View>

      <View style={styles.connRow}>
        {Object.entries(dash.connectors).map(([k, v]) => (
          <View key={k} style={styles.connChip}>
            <View style={[styles.connDot, { backgroundColor: CONN_COLOR[v as string] || "#888" }]} />
            <Text style={styles.connText}>{k.replace(/_/g, " ")}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>PostHog & Sentry remain the source systems — dormant until keys are added. Homie HQ only prioritizes.</Text>

      {/* URGENT */}
      <Section title="Urgent" icon="alert-octagon" color="#EB5757" />
      {att.urgent.length === 0 ? <Text style={styles.empty}>Nothing urgent. </Text> :
        att.urgent.map((a: any) => (
          <View key={a.id} style={[styles.card, { borderLeftColor: SEV_COLOR[a.severity], borderLeftWidth: 3 }]}>
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.cardBody}>{a.description}</Text>
            <View style={styles.actRow}>
              <Pressable testID={`hq-ack-${a.id}`} disabled={busy} style={styles.smallBtn} onPress={() => alertAction(a.id, "acknowledge")}><Text style={styles.smallBtnText}>Acknowledge</Text></Pressable>
              <Pressable testID={`hq-resolve-${a.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => alertAction(a.id, "resolve")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Resolve</Text></Pressable>
            </View>
          </View>
        ))}

      {/* NEEDS REVIEW / APPROVALS */}
      <Section title="Needs review" icon="clipboard-check-outline" color="#F2994A" />
      {approvals.length === 0 && att.needs_review.length === 0 ? <Text style={styles.empty}>No pending approvals or reviews.</Text> : null}
      {approvals.map((ap: any) => (
        <View key={ap.id} style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { borderColor: colors.brandPrimary }]}><Text style={[styles.badgeText, { color: colors.brandPrimary }]}>APPROVAL · {ap.recommendation?.risk_level}</Text></View>
          </View>
          <Text style={styles.cardTitle}>{ap.recommendation?.title}</Text>
          <Text style={styles.cardBody}>{ap.recommendation?.recommended_action}</Text>
          <Text style={styles.metaLine}>Impact: {ap.recommendation?.estimated_impact} · Confidence {ap.recommendation?.confidence_score}%</Text>
          <View style={styles.actRow}>
            <Pressable testID={`hq-approve-${ap.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => decide(ap.id, "approved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Approve</Text></Pressable>
            <Pressable testID={`hq-reject-${ap.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => decide(ap.id, "rejected")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Reject</Text></Pressable>
          </View>
        </View>
      ))}
      {att.needs_review.filter((x: any) => x.type === "insight").map((i: any) => (
        <InsightCard key={i.id} i={i} />
      ))}

      {/* AI COSTS */}
      <Section title="AI cost intelligence" icon="brain" color={colors.brandPrimary} />
      <View style={styles.statRow}>
        <Stat label="Cost 24h $" value={ai?.today?.cost_24h ?? 0} />
        <Stat label="Requests" value={ai?.today?.requests_24h ?? 0} />
        <Stat label="Per user $" value={ai?.today?.cost_per_active_user ?? 0} />
        <Stat label="Failed" value={ai?.today?.failed_requests_24h ?? 0} accent={(ai?.today?.failed_requests_24h ?? 0) > 0} />
      </View>
      {Object.keys(ai?.today?.by_feature || {}).length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>By feature area</Text>
          {Object.entries(ai.today.by_feature).map(([k, v]) => (
            <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k}</Text><Text style={styles.v}>${v as number}</Text></View>
          ))}
        </View>
      ) : <Text style={styles.empty}>No AI usage recorded in the last 24h yet.</Text>}
      <Text style={styles.note}>{ai?.disclaimer}</Text>

      {/* OPPORTUNITIES */}
      <Section title="Opportunities" icon="lightbulb-on-outline" color="#2F80ED" />
      {att.opportunities.length === 0 ? <Text style={styles.empty}>No opportunities surfaced.</Text> :
        att.opportunities.map((i: any) => <InsightCard key={i.id} i={i} />)}

      {/* SUCCESSES */}
      <Section title="Successes" icon="trophy-outline" color="#27AE60" />
      {att.successes.length === 0 ? <Text style={styles.empty}>No positive signals yet.</Text> :
        att.successes.map((i: any) => <InsightCard key={i.id} i={i} />)}

      {/* DOMAIN OVERVIEW */}
      <Section title="Domain overview" icon="view-dashboard-outline" color={colors.onSurfaceSecondary} />
      <DomainCard title="App health" rows={[["Errors 24h", dom.app_health.errors_24h], ["Server errors", dom.app_health.server_errors_24h], ["Open incidents", dom.app_health.open_incidents]]} />
      <DomainCard title="Revenue" rows={[["MRR $", dom.revenue.mrr], ["Revenue (30d) $", dom.revenue.revenue_month], ["Paying users", dom.revenue.paying_users], ["Partner rev $", dom.revenue.partner_revenue_month]]} />
      <DomainCard title="Growth" rows={[["New users 7d", dom.growth.new_users_7d], ["Projects started 7d", dom.growth.projects_created_7d], ["Completed 7d", dom.growth.projects_completed_7d], ["Activation %", dom.growth.activation_pct]]} />
      <DomainCard title="Support" rows={[["Open tickets", dom.support.open_tickets], ["Fraud pending", dom.support.fraud_pending]]} />
    </ScrollView>
  );
}

function Section({ title, icon, color }: { title: string; icon: string; color: string }) {
  return <View style={styles.sectionRow}><MaterialCommunityIcons name={icon as any} size={18} color={color} /><Text style={styles.section}>{title}</Text></View>;
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function InsightCard({ i }: { i: any }) {
  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}><View style={[styles.badge, { borderColor: colors.onSurfaceTertiary }]}><Text style={styles.badgeText}>{i.insight_type} · impact {i.impact_score}</Text></View></View>
      <Text style={styles.cardTitle}>{i.title}</Text>
      <Text style={styles.cardBody}>{i.summary}</Text>
      <Text style={styles.metaLine}>Confidence {i.confidence_score}% · evidence: {Object.keys(i.evidence || {}).join(", ")}</Text>
    </View>
  );
}
function DomainCard({ title, rows }: { title: string; rows: [string, any][] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  connRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  connChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 19 },
  metaLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 6 },
  badgeRow: { flexDirection: "row", marginBottom: 4 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
