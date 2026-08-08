import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Switch } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const PARTNER_TYPES = ["instant_buyback", "trade_in", "managed_marketplace", "private_sale", "donation", "recycle", "dispose"];
const CATS = ["Phones & Electronics", "Tools", "Appliances", "Lawn Equipment", "Furniture", "Building Materials"];

export function AssetExitModule() {
  const [dash, setDash] = useState<any>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // add partner
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState("managed_marketplace");
  const [pcat, setPcat] = useState<string[]>([]);
  const [compensated, setCompensated] = useState(false);
  const [disclosure, setDisclosure] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, f] = await Promise.all([api<any>("/hi/admin/exit/dashboard"), api<any>("/hi/admin/exit/flags")]);
      setDash(d); setFlags(f.flags || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleCat = async (category: string, enabled: boolean) => {
    setBusy(true);
    try { await api("/hi/admin/exit/categories", { method: "PUT", body: { category, enabled } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const togglePartner = async (p: any) => {
    setBusy(true);
    try { await api(`/hi/admin/exit/partners/${p.id}`, { method: "PATCH", body: { status: p.status === "active" ? "paused" : "active" } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const removePartner = async (p: any) => {
    setBusy(true);
    try { await api(`/hi/admin/exit/partners/${p.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't remove", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const addPartner = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Enter a partner name."); return; }
    if (compensated && !disclosure.trim()) { Alert.alert("Disclosure required", "Compensated partners need a disclosure."); return; }
    setBusy(true);
    try {
      await api("/hi/admin/exit/partners", { method: "POST", body: {
        name: name.trim(), partner_type: ptype, eligible_categories: pcat, compensated, disclosure_text: disclosure.trim() || null, reliability_score: 60,
      }});
      setName(""); setDisclosure(""); setCompensated(false); setPcat([]);
      await load();
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const resolveFlag = async (fid: string) => {
    setBusy(true);
    try { await api(`/hi/admin/exit/flags/${fid}/resolve`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't resolve", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Asset Exit & Resale</Text>
        <Pressable testID="exit-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Total cases" value={dash.total_cases} />
        <Stat label="Completed" value={dash.cases_by_status.completed} />
        <Stat label="Realized $" value={dash.realized_value_total} />
        <Stat label="Flags" value={dash.open_valuation_flags} accent={dash.open_valuation_flags > 0} />
      </View>

      <Text style={styles.section}>Categories</Text>
      <View style={styles.card}>
        {Object.entries(dash.categories).map(([c, en]) => (
          <View key={c} style={styles.rowBetween}><Text style={styles.k}>{c}</Text><Switch value={en as boolean} onValueChange={(v) => toggleCat(c, v)} trackColor={{ true: colors.brandPrimary }} /></View>
        ))}
      </View>

      <Text style={styles.section}>Completed by exit path</Text>
      <View style={styles.card}>
        {Object.keys(dash.completed_by_exit).length === 0 ? <Text style={styles.note}>No completed dispositions yet.</Text> :
          Object.entries(dash.completed_by_exit).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>

      <Text style={styles.section}>Exit partners ({(dash.partners || []).length})</Text>
      {(dash.partners || []).map((p: any) => (
        <View key={p.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pName}>{p.name}</Text>
              <Text style={styles.pMeta}>{p.partner_type.replace(/_/g, " ")} · reliability {p.reliability_score} · {p.compensated ? "compensated" : "no commission"} · {p.conversions || 0} conversions</Text>
              {p.compensated && !p.disclosure_text ? <Text style={styles.warn}>Missing disclosure</Text> : null}
              <Text style={styles.pCats}>{(p.eligible_categories || []).join(", ") || "no categories"}</Text>
            </View>
            <View style={[styles.tag, { borderColor: p.status === "active" ? "#27AE60" : colors.onSurfaceTertiary }]}>
              <Text style={[styles.tagText, { color: p.status === "active" ? "#27AE60" : colors.onSurfaceTertiary }]}>{p.status}</Text>
            </View>
          </View>
          <View style={styles.actRow}>
            <Pressable testID={`exit-partner-toggle-${p.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: p.status === "active" ? "#EB5757" : "#27AE60" }]} onPress={() => togglePartner(p)}>
              <Text style={[styles.smallBtnText, { color: p.status === "active" ? "#EB5757" : "#27AE60" }]}>{p.status === "active" ? "Pause" : "Activate"}</Text>
            </Pressable>
            <Pressable testID={`exit-partner-del-${p.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: colors.onSurfaceTertiary }]} onPress={() => removePartner(p)}>
              <Text style={[styles.smallBtnText, { color: colors.onSurfaceTertiary }]}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>Add partner</Text>
      <View style={styles.card}>
        <TextInput testID="exit-partner-name" value={name} onChangeText={setName} placeholder="Partner name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
        <Text style={styles.label}>Type</Text>
        <View style={styles.chipRow}>
          {PARTNER_TYPES.map((t) => <Pressable key={t} style={[styles.chip, ptype === t && styles.chipOn]} onPress={() => setPtype(t)}><Text style={[styles.chipText, ptype === t && styles.chipTextOn]}>{t.replace(/_/g, " ")}</Text></Pressable>)}
        </View>
        <Text style={styles.label}>Eligible categories</Text>
        <View style={styles.chipRow}>
          {CATS.map((c) => { const on = pcat.includes(c); return <Pressable key={c} style={[styles.chip, on && styles.chipOn]} onPress={() => setPcat(on ? pcat.filter((x) => x !== c) : [...pcat, c])}><Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text></Pressable>; })}
        </View>
        <View style={styles.rowBetween}><Text style={styles.k}>Compensated (paid link)</Text><Switch value={compensated} onValueChange={setCompensated} trackColor={{ true: colors.brandPrimary }} /></View>
        {compensated ? <TextInput value={disclosure} onChangeText={setDisclosure} placeholder="Disclosure text (required)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /> : null}
        <Pressable testID="exit-partner-add" disabled={busy} style={styles.primaryBtn} onPress={addPartner}><Text style={styles.primaryBtnText}>Add partner</Text></Pressable>
        <Text style={styles.note}>Routing prioritizes user value, eligibility, reliability, safety, geography and convenience — never commission alone.</Text>
      </View>

      <Text style={styles.section}>Valuation flags ({flags.length})</Text>
      {flags.length === 0 ? <Text style={styles.note}>No reported valuation issues.</Text> :
        flags.map((f) => (
          <View key={f.id} style={styles.card}>
            <Text style={styles.pName}>{f.category}</Text>
            <Text style={styles.pMeta}>{f.reason}</Text>
            <Pressable testID={`exit-flag-${f.id}`} disabled={busy} style={[styles.smallBtn, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={() => resolveFlag(f.id)}><Text style={styles.smallBtnText}>Resolve</Text></Pressable>
          </View>
        ))}
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
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  pName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  pMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  pCats: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: 3 },
  warn: { color: colors.warning, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.xs },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.xs, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  primaryBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
