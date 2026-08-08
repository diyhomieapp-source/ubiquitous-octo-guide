import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function InvestorIntelModule() {
  const [tab, setTab] = useState<"overview" | "vendors" | "transfer" | "dataroom">("overview");
  const [dash, setDash] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [transfer, setTransfer] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [vName, setVName] = useState("");
  const [invRef, setInvRef] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, v, t, i] = await Promise.all([
        api<any>("/hi/admin/invintel/dashboard"), api<any>("/hi/admin/invintel/vendors"),
        api<any>("/hi/admin/invintel/transfer"), api<any>("/hi/admin/invintel/invites"),
      ]);
      setDash(d); setVendors(v.vendors || []); setTransfer(t.tasks || []); setInvites(i.invites || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => { setBusy(true); try { await api("/hi/admin/invintel/metrics/refresh", { method: "POST" }); await load(); } catch {} finally { setBusy(false); } };
  const addVendor = async () => {
    if (!vName.trim()) { Alert.alert("Name needed", "Enter a vendor name."); return; }
    setBusy(true);
    try { await api("/hi/admin/invintel/vendors", { method: "POST", body: { vendor_name: vName, category: "infrastructure", criticality: "medium", transfer_status: "documented" } }); setVName(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const createInvite = async () => {
    if (!invRef.trim()) { Alert.alert("Contact needed", "Enter investor contact reference."); return; }
    setBusy(true);
    try { await api("/hi/admin/invintel/invites", { method: "POST", body: { investor_contact_reference: invRef, access_scope: ["growth", "revenue", "product"] } }); setInvRef(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const revoke = async (iid: string) => { setBusy(true); try { await api(`/hi/admin/invintel/invites/${iid}/revoke`, { method: "PUT" }); await load(); } catch {} finally { setBusy(false); } };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}><Text style={styles.h1}>Investor Intel</Text><Pressable testID="ii-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable></View>
      <View style={styles.tabs}>{(["overview", "vendors", "transfer", "dataroom"] as const).map((t) => <Pressable key={t} testID={`ii-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}><Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text></Pressable>)}</View>

      {tab === "overview" && (
        <>
          <View style={styles.statRow}>
            <Stat label="Users" value={dash.growth.registered_users} />
            <Stat label="Projects" value={dash.growth.projects_created} />
            <Stat label="Completed" value={dash.growth.projects_completed} />
            <Stat label="Subscribers" value={dash.revenue.paying_subscribers} />
          </View>
          <View style={styles.statRow}>
            <Stat label="Vendors" value={dash.operating.vendors} />
            <Stat label="Docs" value={dash.operating.operational_documents} />
            <Stat label="Readiness" value={dash.overall_readiness ?? "—"} />
            <Stat label="Transfer" value={`${dash.transfer_tasks.completed}/${dash.transfer_tasks.total}`} />
          </View>
          <Pressable testID="ii-metrics-refresh" disabled={busy} style={styles.primaryBtn} onPress={refresh}><Text style={styles.primaryText}>Refresh metric snapshots</Text></Pressable>
          <Text style={styles.note}>{dash.note}</Text>
        </>
      )}

      {tab === "vendors" && (
        <>
          <View style={styles.addRow}><TextInput testID="ii-vendor-name" value={vName} onChangeText={setVName} placeholder="Vendor name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /><Pressable testID="ii-vendor-add" disabled={busy} style={styles.addBtn} onPress={addVendor}><Text style={styles.addBtnText}>Add</Text></Pressable></View>
          {vendors.map((v) => <View key={v.id} style={styles.card}><Text style={styles.rTitle}>{v.vendor_name}</Text><Text style={styles.rMeta}>{v.category} · {v.criticality} · {v.transfer_status.replace(/_/g, " ")}</Text></View>)}
        </>
      )}

      {tab === "transfer" && (transfer.length === 0 ? <Text style={styles.note}>No transfer tasks yet.</Text> : transfer.map((t) => <View key={t.id} style={styles.card}><Text style={styles.rTitle}>{t.title}</Text><Text style={styles.rMeta}>{t.category} · {t.status.replace(/_/g, " ")}</Text></View>))}

      {tab === "dataroom" && (
        <>
          <View style={styles.addRow}><TextInput testID="ii-invite-ref" value={invRef} onChangeText={setInvRef} placeholder="Investor contact reference" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /><Pressable testID="ii-invite-create" disabled={busy} style={styles.addBtn} onPress={createInvite}><Text style={styles.addBtnText}>Invite</Text></Pressable></View>
          {invites.map((v) => (
            <View key={v.id} style={styles.card}>
              <View style={styles.labelRow}><Text style={styles.rTitle}>{v.investor_contact_reference}</Text><Text style={styles.rMeta}>{v.status}</Text></View>
              <Text style={styles.rMeta}>scope: {(v.access_scope || []).join(", ")}</Text>
              {v.status !== "revoked" ? <Pressable testID={`ii-invite-revoke-${v.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => revoke(v.id)}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Revoke</Text></Pressable> : null}
            </View>
          ))}
          <Text style={styles.note}>Invites are scoped, time-limited & revocable. No credentials or customer private data are ever in the data room.</Text>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md, flexWrap: "wrap" },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  smallBtn: { alignSelf: "flex-start", borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.sm },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.md },
});
