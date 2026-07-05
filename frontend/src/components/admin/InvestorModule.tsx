import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Kpis = {
  generated_at: string;
  users: { total: number; active_30d: number; new_30d: number; new_prev_30d: number; growth_pct_mom: number | null };
  revenue: { mrr_cents: number; arr_cents: number; arpu_cents: number; revenue_month_cents: number; monthly_expenses_cents: number; net_monthly_cents: number; cash_on_hand_cents: number; runway_months: number | null; paying_users: number; tier_counts: Record<string, number> };
  engagement: { projects_total: number; projects_completed: number; projects_new_30d: number; completion_rate_pct: number; blog_posts_published: number; community_projects: number; certificates_issued: number; education_lessons: number; pro_partners: number; referrals: number };
  conversion: { free_to_paid_pct: number; churn_pct: number };
};
type ReportRow = { id: string; created_at: string; period: string; audience: string; title: string; tldr: string };
type FullReport = ReportRow & { sections: { heading: string; body: string }[]; metrics_table: { label: string; value: string }[]; asks: string[]; risks: string[] };
type AskResp = { answer: string; supporting_metrics: { label: string; value: string }[] };

const usd = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const PERIODS = ["monthly", "quarterly", "annual"];

export function InvestorModule() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("monthly");
  const [highlights, setHighlights] = useState("");
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState<FullReport | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResp | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, r] = await Promise.all([
        api<Kpis>("/admin/investor/kpis"),
        api<{ reports: ReportRow[] }>("/admin/investor/reports"),
      ]);
      setKpis(k); setReports(r.reports);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    setGenerating(true);
    try {
      const doc = await api<FullReport>("/admin/investor/reports", { method: "POST", body: { period, audience: "investors", highlights: highlights.trim() || undefined } });
      setHighlights(""); setOpen(doc); load();
    } catch (e: any) { Alert.alert("Couldn't generate", e?.message || "Try again."); }
    finally { setGenerating(false); }
  };

  const openReport = async (id: string) => {
    try { setOpen(await api<FullReport>(`/admin/investor/reports/${id}`)); } catch {}
  };
  const del = async (id: string) => {
    try { await api(`/admin/investor/reports/${id}`, { method: "DELETE" }); if (open?.id === id) setOpen(null); load(); } catch {}
  };
  const ask = async () => {
    const q = question.trim(); if (!q) return;
    setAsking(true); setAnswer(null);
    try { setAnswer(await api<AskResp>("/admin/investor/ask", { method: "POST", body: { question: q } })); }
    catch (e: any) { Alert.alert("Couldn't answer", e?.message || "Try again."); }
    finally { setAsking(false); }
  };

  if (loading || !kpis) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  if (open) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
        <Pressable testID="inv-back" style={styles.backRow} onPress={() => setOpen(null)}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={colors.brandPrimary} />
          <Text style={styles.backText}>All reports</Text>
        </Pressable>
        <Text style={styles.reportTitle}>{open.title}</Text>
        <Text style={styles.reportMeta}>{open.period} · {open.audience} · {(open.created_at || "").slice(0, 10)}</Text>
        {!!open.tldr && <View style={styles.tldr}><Text style={styles.tldrText}>{open.tldr}</Text></View>}

        {open.metrics_table?.length > 0 && (
          <View style={styles.metricsCard}>
            {open.metrics_table.map((m, i) => (
              <View key={i} style={styles.metricRow}><Text style={styles.metricLabel}>{m.label}</Text><Text style={styles.metricVal}>{m.value}</Text></View>
            ))}
          </View>
        )}
        {open.sections?.map((s, i) => (
          <View key={i} style={{ marginTop: spacing.lg }}>
            <Text style={styles.secHead}>{s.heading}</Text>
            <Text style={styles.secBody}>{s.body}</Text>
          </View>
        ))}
        {open.asks?.length > 0 && (
          <>
            <Text style={styles.secHead}>Our asks</Text>
            {open.asks.map((a, i) => <Text key={i} style={styles.bullet}>• {a}</Text>)}
          </>
        )}
        {open.risks?.length > 0 && (
          <>
            <Text style={[styles.secHead, { color: colors.warning }]}>Risks</Text>
            {open.risks.map((a, i) => <Text key={i} style={styles.bullet}>• {a}</Text>)}
          </>
        )}
        <Pressable testID="inv-delete" style={styles.delBtn} onPress={() => del(open.id)}>
          <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
          <Text style={styles.delText}>Delete report</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const r = kpis.revenue, u = kpis.users, e = kpis.engagement, c = kpis.conversion;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Investor Reporting</Text>
        <Pressable testID="inv-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>
      <Text style={styles.subtitle}>Live KPIs · updated {(kpis.generated_at || "").slice(11, 16)} UTC</Text>

      <Text style={styles.section}>Growth</Text>
      <View style={styles.statRow}>
        <Stat label="Total users" value={String(u.total)} />
        <Stat label="Active 30d" value={String(u.active_30d)} />
        <Stat label="New 30d" value={String(u.new_30d)} />
        <Stat label="MoM growth" value={u.growth_pct_mom == null ? "—" : `${u.growth_pct_mom}%`} accent={(u.growth_pct_mom || 0) > 0} />
      </View>

      <Text style={styles.section}>Revenue</Text>
      <View style={styles.statRow}>
        <Stat label="MRR" value={usd(r.mrr_cents)} />
        <Stat label="ARR" value={usd(r.arr_cents)} />
        <Stat label="ARPU" value={usd(r.arpu_cents)} />
        <Stat label="Paying" value={String(r.paying_users)} />
      </View>
      <View style={styles.statRow}>
        <Stat label="Net / mo" value={usd(r.net_monthly_cents)} accent={r.net_monthly_cents < 0} />
        <Stat label="Cash" value={usd(r.cash_on_hand_cents)} />
        <Stat label="Runway" value={r.runway_months == null ? "—" : `${r.runway_months}mo`} />
        <Stat label="Churn" value={`${c.churn_pct}%`} />
      </View>

      <Text style={styles.section}>Engagement</Text>
      <View style={styles.statRow}>
        <Stat label="Projects" value={String(e.projects_total)} />
        <Stat label="Completed" value={`${e.completion_rate_pct}%`} />
        <Stat label="Free→Paid" value={`${c.free_to_paid_pct}%`} />
        <Stat label="Referrals" value={String(e.referrals)} />
      </View>
      <View style={styles.statRow}>
        <Stat label="Blog" value={String(e.blog_posts_published)} />
        <Stat label="Communities" value={String(e.community_projects)} />
        <Stat label="Certs" value={String(e.certificates_issued)} />
        <Stat label="Pros" value={String(e.pro_partners)} />
      </View>

      <Text style={styles.section}>Generate investor update</Text>
      <View style={styles.chipRow}>
        {PERIODS.map((p) => (
          <Pressable key={p} testID={`inv-period-${p}`} style={[styles.chip, period === p && styles.chipOn]} onPress={() => setPeriod(p)}>
            <Text style={[styles.chipText, period === p && styles.chipTextOn]}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="inv-highlights"
        style={styles.input}
        placeholder="Optional founder highlights to weave in…"
        placeholderTextColor={colors.onSurfaceTertiary}
        value={highlights}
        onChangeText={setHighlights}
        multiline
      />
      <Pressable testID="inv-generate" style={[styles.primaryBtn, generating && { opacity: 0.6 }]} disabled={generating} onPress={generate}>
        {generating ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="file-document-edit-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryBtnText}>Generate AI report</Text></>}
      </Pressable>

      <Text style={styles.section}>Saved reports</Text>
      {reports.length === 0 ? <Text style={styles.help}>No reports yet — generate your first update above.</Text> :
        reports.map((rep) => (
          <Pressable key={rep.id} testID={`inv-report-${rep.id}`} style={styles.reportRow} onPress={() => openReport(rep.id)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{rep.title}</Text>
              <Text style={styles.rowMeta}>{rep.period} · {(rep.created_at || "").slice(0, 10)}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}

      <Text style={styles.section}>Investor Q&A bot</Text>
      <Text style={styles.help}>Answers are grounded only on live KPIs — no fabricated numbers.</Text>
      <TextInput
        testID="inv-question"
        style={styles.input}
        placeholder="e.g. What is our runway and burn rate?"
        placeholderTextColor={colors.onSurfaceTertiary}
        value={question}
        onChangeText={setQuestion}
      />
      <Pressable testID="inv-ask" style={[styles.primaryBtn, asking && { opacity: 0.6 }]} disabled={asking} onPress={ask}>
        {asking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryBtnText}>Ask</Text></>}
      </Pressable>
      {answer && (
        <View style={styles.answerCard}>
          <Text style={styles.answerText}>{answer.answer}</Text>
          {answer.supporting_metrics?.length > 0 && (
            <View style={styles.badges}>
              {answer.supporting_metrics.map((m, i) => (
                <View key={i} style={styles.metricBadge}><Text style={styles.metricBadgeText}>{m.label}: {m.value}</Text></View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.error }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  refreshBtn: { padding: spacing.xs },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 17 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.sm, minHeight: 44 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  reportRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  rowTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rowMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  answerCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  answerText: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  metricBadge: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  metricBadgeText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11 },
  // report detail
  backRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  backText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  reportTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginTop: spacing.xs },
  reportMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  tldr: { backgroundColor: colors.brandPrimary + "18", borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  tldrText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 20 },
  metricsCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  metricRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  metricLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  metricVal: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  secHead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.md, marginTop: spacing.md, marginBottom: spacing.xs },
  secBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  bullet: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: 2 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl, paddingVertical: spacing.sm },
  delText: { color: colors.error, fontFamily: font.bold, fontSize: type.sm },
});
