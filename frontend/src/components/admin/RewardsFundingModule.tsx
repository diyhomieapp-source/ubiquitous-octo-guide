import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const SUSTAIN_COLOR: Record<string, string> = { green: "#27AE60", yellow: "#F2994A", red: "#EB5757" };
const SOURCES = ["affiliate", "referral", "sponsorship", "manufacturer_program", "other"];

export function RewardsFundingModule() {
  const [cc, setCc] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // revenue form
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("affiliate");
  const [markReceived, setMarkReceived] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f] = await Promise.all([api<any>("/hi/admin/rewards/command-center"), api<any>("/hi/admin/rewards/fraud-reviews")]);
      setCc(c); setReviews(f.reviews || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const recordRevenue = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert("Enter amount", "Add a positive revenue amount."); return; }
    setBusy(true);
    try {
      await api("/hi/admin/rewards/revenue", { method: "POST", body: { source_type: source, amount: amt, mark_received: markReceived } });
      setAmount("");
      await load();
    } catch (e: any) { Alert.alert("Couldn't record", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const setEmergency = async (enabled: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/rewards/emergency-mode", { method: "POST", body: { enabled } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const toggleSetting = async (key: string, value: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/rewards/settings", { method: "PUT", body: { [key]: value } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const receive = async (id: string) => {
    setBusy(true);
    try { await api(`/hi/admin/rewards/revenue/${id}/receive`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const toggleProvider = async (p: any) => {
    setBusy(true);
    try { await api(`/hi/admin/rewards/providers/${p.id}/${p.status === "active" ? "pause" : "activate"}`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const decide = async (fid: string, decision: string) => {
    setBusy(true);
    try { await api(`/hi/admin/rewards/fraud-reviews/${fid}/decide`, { method: "POST", body: { decision, reason: decision === "approved" ? "Manual admin approval" : "Manual admin rejection" } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't decide", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !cc) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const f = cc.funding; const s = cc.settings; const li = cc.liability;
  const sustColor = SUSTAIN_COLOR[li.sustainability_status] || colors.onSurfaceTertiary;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Rewards Funding</Text>
        <Pressable testID="rf-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      {s.emergency_mode ? (
        <View style={styles.emergencyBanner}>
          <MaterialCommunityIcons name="alert-octagon" size={18} color="#EB5757" />
          <Text style={styles.emergencyText}>Emergency mode is ON — redemptions paused. Core DIYhomie features are unaffected.</Text>
        </View>
      ) : null}

      <Text style={styles.section}>Funding pool</Text>
      <View style={styles.statRow}>
        <Stat label="Confirmed $" value={f.confirmed_funds} />
        <Stat label="Available $" value={f.available_redemption_budget} accent />
        <Stat label="Committed $" value={f.committed_funds} />
        <Stat label="Reserve $" value={f.reserved_funds} />
      </View>

      <Text style={styles.section}>Liability & sustainability</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}><Text style={styles.k}>Outstanding points</Text><Text style={styles.v}>{(li.outstanding_points || 0).toLocaleString()}</Text></View>
        <View style={styles.rowBetween}><Text style={styles.k}>Estimated liability</Text><Text style={styles.v}>${li.estimated_liability}</Text></View>
        <View style={styles.rowBetween}><Text style={styles.k}>Funding ratio</Text><Text style={styles.v}>{li.funding_ratio == null ? "—" : li.funding_ratio}</Text></View>
        <View style={styles.rowBetween}><Text style={styles.k}>Status</Text><View style={[styles.tag, { borderColor: sustColor }]}><Text style={[styles.tagText, { color: sustColor }]}>{li.sustainability_status}</Text></View></View>
      </View>

      <Text style={styles.section}>Record partner revenue</Text>
      <View style={styles.card}>
        <View style={styles.chipRow}>
          {SOURCES.map((src) => (
            <Pressable key={src} testID={`rf-src-${src}`} style={[styles.chip, source === src && styles.chipOn]} onPress={() => setSource(src)}>
              <Text style={[styles.chipText, source === src && styles.chipTextOn]}>{src.replace(/_/g, " ")}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput testID="rf-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount (USD)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
        <View style={styles.rowBetween}><Text style={styles.k}>Mark as received (confirmed)</Text><Switch value={markReceived} onValueChange={setMarkReceived} trackColor={{ true: colors.brandPrimary }} /></View>
        <Pressable testID="rf-record" disabled={busy} style={styles.primaryBtn} onPress={recordRevenue}><Text style={styles.primaryBtnText}>Record revenue</Text></Pressable>
        <Text style={styles.note}>Only received (confirmed) revenue funds the redemption budget. Approved-but-not-received revenue is shown as projected only.</Text>
      </View>

      <Text style={styles.section}>Recent revenue ({(cc.revenue.recent || []).length})</Text>
      {(cc.revenue.recent || []).length === 0 ? <Text style={styles.note}>No revenue recorded yet.</Text> :
        (cc.revenue.recent).map((e: any) => (
          <View key={e.id} style={styles.revRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.revName}>{e.source_type.replace(/_/g, " ")} · ${e.amount}</Text>
              <Text style={styles.revMeta}>{e.status}</Text>
            </View>
            {e.status !== "received" && e.status !== "reversed" ? (
              <Pressable testID={`rf-receive-${e.id}`} disabled={busy} style={styles.smallBtn} onPress={() => receive(e.id)}><Text style={styles.smallBtnText}>Mark received</Text></Pressable>
            ) : null}
          </View>
        ))}

      <Text style={styles.section}>Financial controls</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}><Text style={styles.k}>Redemption enabled</Text><Switch value={s.redemption_enabled} onValueChange={(v) => toggleSetting("redemption_enabled", v)} trackColor={{ true: colors.brandPrimary }} /></View>
        <View style={styles.rowBetween}><Text style={styles.k}>Issuance enabled</Text><Switch value={s.issuance_enabled} onValueChange={(v) => toggleSetting("issuance_enabled", v)} trackColor={{ true: colors.brandPrimary }} /></View>
        <View style={styles.rowBetween}>
          <Text style={[styles.k, { color: "#EB5757" }]}>Emergency pause</Text>
          <Switch testID="rf-emergency" value={s.emergency_mode} onValueChange={setEmergency} trackColor={{ true: "#EB5757" }} />
        </View>
        <Text style={styles.note}>Emergency pause halts all redemptions instantly but never touches core DIYhomie features. Safety reserve ${s.safety_reserve} · {s.cents_per_point}¢/point.</Text>
      </View>

      <Text style={styles.section}>Fulfillment</Text>
      <View style={styles.statRow}>
        <Stat label="Held" value={cc.fulfillment.points_held} />
        <Stat label="Fulfilled" value={cc.fulfillment.fulfilled} />
        <Stat label="Failed" value={cc.fulfillment.failed} accent={cc.fulfillment.failed > 0} />
        <Stat label="Review" value={cc.fulfillment.fraud_review} accent={cc.fulfillment.fraud_review > 0} />
      </View>

      <Text style={styles.section}>Providers</Text>
      {(cc.providers || []).map((p: any) => (
        <View key={p.id} style={styles.revRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.revName}>{p.name}{p.simulated ? " · simulated" : ""}</Text>
            <Text style={styles.revMeta}>{p.provider_type} · {p.status}</Text>
          </View>
          <Pressable testID={`rf-prov-${p.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: p.status === "active" ? "#EB5757" : "#27AE60" }]} onPress={() => toggleProvider(p)}>
            <Text style={[styles.smallBtnText, { color: p.status === "active" ? "#EB5757" : "#27AE60" }]}>{p.status === "active" ? "Pause" : "Activate"}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>Fraud reviews ({reviews.length})</Text>
      {reviews.length === 0 ? <Text style={styles.note}>No redemptions pending review.</Text> :
        reviews.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.revName}>Risk {r.risk_score} · {r.risk_reason}</Text>
            <Text style={styles.revMeta}>User {String(r.user_id).slice(0, 8)} · {new Date(r.created_at).toLocaleDateString()}</Text>
            <View style={styles.decideRow}>
              <Pressable testID={`rf-approve-${r.id}`} disabled={busy} style={[styles.decideBtn, { borderColor: "#27AE60" }]} onPress={() => decide(r.id, "approved")}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Approve</Text></Pressable>
              <Pressable testID={`rf-reject-${r.id}`} disabled={busy} style={[styles.decideBtn, { borderColor: "#EB5757" }]} onPress={() => decide(r.id, "rejected")}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Reject &amp; return points</Text></Pressable>
            </View>
          </View>
        ))}

      <Text style={styles.note}>Points are held (not lost) until fulfillment or an admin decision. Rejected redemptions return points automatically.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  emergencyBanner: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: "#EB575718", borderColor: "#EB575755", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  emergencyText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  primaryBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
  revRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  revName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  revMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  decideRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  decideBtn: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
});
