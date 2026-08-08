import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Conn = {
  id: string; connector_key: string; name: string; category: string; connection_type: string;
  status: string; health_status: string; credential_status: string; automation_level: number;
  automation_label: string; error_rate: number; pending_jobs: number; failed_jobs: number;
  last_successful_request: string | null; last_webhook_received: string | null; last_checked_at: string | null;
};

const HEALTH_COLOR: Record<string, string> = { healthy: colors.success, dormant: colors.warning, disabled: colors.onSurfaceTertiary, error: colors.error };
const JOB_COLOR: Record<string, string> = {
  succeeded: colors.success, queued: colors.info, running: colors.info, retrying: colors.warning,
  failed_retryable: colors.warning, awaiting_approval: "#9B51E0", failed_final: colors.error,
  dead_letter: colors.error, cancelled: colors.onSurfaceTertiary,
};

export function IntegrationsModule() {
  const [summary, setSummary] = useState<any>(null);
  const [connectors, setConnectors] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api<any>("/hi/admin/integrations/dashboard"); setSummary(d.summary); setConnectors(d.connectors); }
    catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openDetail = async (id: string) => {
    setOpenId(id); setDetail(null);
    try { setDetail(await api<any>(`/hi/admin/integrations/connectors/${id}`)); } catch {}
  };

  const act = async (fn: () => Promise<any>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (openId) setDetail(await api<any>(`/hi/admin/integrations/connectors/${openId}`)); await load(); if (msg) Alert.alert("Done", msg); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !summary) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  if (openId && detail) {
    const c = detail.connector;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
        <Pressable testID="ig-back" style={styles.backRow} onPress={() => { setOpenId(null); setDetail(null); }}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={colors.brandPrimary} /><Text style={styles.backText}>All connectors</Text>
        </Pressable>
        <Text style={styles.h1}>{c.name}</Text>
        <Text style={styles.sub}>{c.description}</Text>
        <View style={styles.tagRow}>
          <View style={styles.tag}><Text style={styles.tagText}>{c.connection_type}</Text></View>
          <View style={styles.tag}><Text style={styles.tagText}>{c.category}</Text></View>
          <View style={styles.tag}><Text style={styles.tagText}>Level {c.automation_level}</Text></View>
          <View style={[styles.tag, { borderColor: c.status === "active" ? colors.success : colors.onSurfaceTertiary }]}><Text style={styles.tagText}>{c.status}</Text></View>
        </View>

        <View style={styles.btnRow}>
          <Pressable testID="ig-test" disabled={busy} style={styles.actBtn} onPress={() => act(() => api(`/hi/admin/integrations/connectors/${c.id}/test`, { method: "POST" }), "Health checked.")}>
            <Text style={styles.actText}>Test connection</Text>
          </Pressable>
          <Pressable testID="ig-test-wf" disabled={busy} style={styles.actBtn} onPress={() => act(() => api(`/hi/admin/integrations/connectors/${c.id}/test-workflow`, { method: "POST" }))}>
            <Text style={styles.actText}>Run test job</Text>
          </Pressable>
          <Pressable testID="ig-toggle" disabled={busy} style={[styles.actBtn, { borderColor: c.status === "active" ? colors.error : colors.success }]}
            onPress={() => act(() => api(`/hi/admin/integrations/connectors/${c.id}`, { method: "PUT", body: { status: c.status === "active" ? "disabled" : "active" } }))}>
            <Text style={[styles.actText, { color: c.status === "active" ? colors.error : colors.success }]}>{c.status === "active" ? "Disable" : "Enable"}</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Credentials (references only)</Text>
        <Text style={styles.help}>The vault stores only a pointer to an environment secret. Values are never shown or returned.</Text>
        {detail.credentials.map((cr: any) => (
          <View key={cr.id} style={styles.credRow}>
            <MaterialCommunityIcons name={cr.configured ? "lock-check" : "lock-alert"} size={18} color={cr.configured ? colors.success : colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.credType}>{cr.credential_type}</Text>
              <Text style={styles.credRef}>{cr.reference}</Text>
              <Text style={styles.credMeta}>
                {cr.configured ? "Connected" : "Not configured"}
                {cr.status === "expiring_soon" ? " · Expiring soon" : cr.status === "expired" ? " · Expired" : ""}
                {cr.last_rotated_at ? ` · Rotated ${(cr.last_rotated_at || "").slice(0, 10)}` : " · Never rotated"}
                {cr.last_checked_at ? ` · Checked ${(cr.last_checked_at || "").slice(0, 10)}` : ""}
              </Text>
            </View>
            <Pressable testID={`ig-rotate-${cr.id}`} disabled={busy} style={styles.smallBtn}
              onPress={() => act(() => api(`/hi/admin/integrations/connectors/${c.id}/rotate`, { method: "POST", body: { credential_reference_id: cr.id, rotation_due_days: 90 } }), "Rotation recorded.")}>
              <Text style={styles.smallBtnText}>Rotate</Text>
            </Pressable>
          </View>
        ))}

        {detail.webhook_subscriptions?.length > 0 && (
          <>
            <Text style={styles.section}>Webhook subscriptions</Text>
            {detail.webhook_subscriptions.map((w: any) => (
              <View key={w.id} style={styles.whRow}>
                <MaterialCommunityIcons name="webhook" size={16} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.whType}>{w.event_type}{w.signature_verification_required ? " · signed" : ""}</Text>
                  <Text style={styles.whRef} numberOfLines={1}>{w.endpoint_reference}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        <Text style={styles.section}>Recent jobs</Text>
        {detail.recent_jobs.length === 0 ? <Text style={styles.help}>No jobs yet.</Text> :
          detail.recent_jobs.map((j: any) => (
            <View key={j.id} style={styles.jobRow}>
              <View style={[styles.jobDot, { backgroundColor: JOB_COLOR[j.status] || colors.onSurfaceTertiary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.jobType}>{j.workflow_type}</Text>
                <Text style={styles.jobMeta}>{j.status} · attempt {j.attempt_count}/{j.max_attempts}{j.sanitized_result ? ` · ${j.sanitized_result}` : ""}</Text>
              </View>
              {j.status === "awaiting_approval" && (
                <Pressable testID={`ig-approve-${j.id}`} disabled={busy} style={styles.smallBtn} onPress={() => act(() => api(`/hi/admin/integrations/jobs/${j.id}/approve`, { method: "POST" }))}><Text style={styles.smallBtnText}>Approve</Text></Pressable>
              )}
              {(j.status === "failed_retryable" || j.status === "dead_letter" || j.status === "failed_final") && (
                <Pressable testID={`ig-retry-${j.id}`} disabled={busy} style={styles.smallBtn} onPress={() => act(() => api(`/hi/admin/integrations/jobs/${j.id}/retry`, { method: "POST" }))}><Text style={styles.smallBtnText}>Retry</Text></Pressable>
              )}
            </View>
          ))}

        <Text style={styles.section}>Health log</Text>
        {detail.recent_health.slice(0, 12).map((h: any) => (
          <Text key={h.id} style={styles.healthLine} numberOfLines={1}>
            {(h.created_at || "").slice(11, 19)} · {h.event_type} · {h.sanitized_message}
          </Text>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Integrations</Text>
        <Pressable testID="ig-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>
      <Text style={styles.help}>Every external service is accessed through the Integration Gateway. Admins monitor health without ever seeing credentials.</Text>

      <View style={styles.statRow}>
        <Stat label="Connectors" value={String(summary.connectors)} />
        <Stat label="Active" value={String(summary.active)} />
        <Stat label="Dormant" value={String(summary.dormant)} />
        <Stat label="Pending" value={String(summary.pending_jobs)} />
        <Stat label="Approvals" value={String(summary.awaiting_approval)} accent={summary.awaiting_approval > 0} />
        <Stat label="Dead-letter" value={String(summary.dead_letter)} accent={summary.dead_letter > 0} />
      </View>

      <Text style={styles.section}>Connectors</Text>
      {connectors.map((c) => (
        <Pressable key={c.id} testID={`ig-conn-${c.connector_key}`} style={styles.connRow} onPress={() => openDetail(c.id)}>
          <View style={[styles.dot, { backgroundColor: HEALTH_COLOR[c.health_status] || colors.onSurfaceTertiary }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.connName}>{c.name}</Text>
            <Text style={styles.connMeta}>
              {c.credential_status === "connected" ? "Connected" : "Not configured"} · {c.connection_type} · L{c.automation_level}
              {c.pending_jobs ? ` · ${c.pending_jobs} pending` : ""}{c.failed_jobs ? ` · ${c.failed_jobs} failed` : ""}
            </Text>
          </View>
          <View style={[styles.healthBadge, { borderColor: HEALTH_COLOR[c.health_status] || colors.border }]}>
            <Text style={[styles.healthText, { color: HEALTH_COLOR[c.health_status] || colors.onSurfaceTertiary }]}>{c.health_status}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      ))}

      <Text style={styles.note}>Secrets live only in the environment-secret vault. Pipedream (workflows) & Browserbase (admin browser) are registered but dormant until keys are added.</Text>
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
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  refreshBtn: { padding: spacing.xs },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 60, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  connRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  connName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  connMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  healthBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  healthText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.xl },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  backText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  tag: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11, textTransform: "capitalize" },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  actBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  credRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  credType: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  credRef: { color: colors.info, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
  credMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, marginTop: 2 },
  whRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  whType: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  whRef: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs },
  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  jobType: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  jobMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, marginTop: 2 },
  healthLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, marginTop: 3 },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
});
