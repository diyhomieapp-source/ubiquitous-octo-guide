import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const STATUS_COLOR: Record<string, string> = { draft: "#888", approved: "#27AE60", deprecated: "#EB5757" };
const A11Y_COLOR: Record<string, string> = { pending: "#888", in_review: "#2F80ED", passed: "#27AE60", failed: "#EB5757" };

export function DesignModule() {
  const [tab, setTab] = useState<"components" | "registry" | "safety">("components");
  const [overview, setOverview] = useState<any>(null);
  const [components, setComponents] = useState<any[]>([]);
  const [registry, setRegistry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVer, setNewVer] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, c, r] = await Promise.all([
        api<any>("/hi/admin/design/overview"),
        api<any>("/hi/admin/design/components"),
        api<any>("/hi/admin/design/registry"),
      ]);
      setOverview(o); setComponents(c.components || []); setRegistry(r);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newKey.trim() || !newVer.trim()) { Alert.alert("Missing info", "Enter a component key and version."); return; }
    setBusy(true);
    try { await api("/hi/admin/design/components", { method: "POST", body: { component_key: newKey.trim(), version: newVer.trim() } }); setNewKey(""); setNewVer(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const patch = async (cid: string, body: any) => {
    setBusy(true);
    try { await api(`/hi/admin/design/components/${cid}`, { method: "PUT", body }); await load(); }
    catch (e: any) { Alert.alert("Blocked", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const remove = async (cid: string) => {
    setBusy(true);
    try { await api(`/hi/admin/design/components/${cid}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't delete", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !overview || !registry) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Design System</Text>
        <Pressable testID="design-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>
      <View style={styles.statRow}>
        <Stat label="Coverage" value={`${overview.coverage_pct}%`} />
        <Stat label="Versions" value={overview.registered_versions} />
        <Stat label="Approved" value={overview.approved} />
        <Stat label="A11y pending" value={overview.a11y_pending} accent={overview.a11y_pending > 0} />
      </View>

      <View style={styles.tabs}>{(["components", "registry", "safety"] as const).map((t) => (
        <Pressable key={t} testID={`design-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
          <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text>
        </Pressable>
      ))}</View>

      {tab === "components" && (
        <>
          <View style={styles.addRow}>
            <TextInput testID="design-key" value={newKey} onChangeText={setNewKey} placeholder="component_key" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { flex: 1.4 }]} autoCapitalize="none" />
            <TextInput testID="design-ver" value={newVer} onChangeText={setNewVer} placeholder="1.0.0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Pressable testID="design-create" disabled={busy} style={styles.addBtn} onPress={create}><Text style={styles.addBtnText}>Add</Text></Pressable>
          </View>
          {components.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.labelRow}>
                <Text style={styles.rTitle}>{c.component_key} · v{c.version}</Text>
                <View style={styles.tagRow}>
                  <View style={[styles.tag, { borderColor: STATUS_COLOR[c.status] }]}><Text style={[styles.tagText, { color: STATUS_COLOR[c.status] }]}>{c.status}</Text></View>
                  <View style={[styles.tag, { borderColor: A11Y_COLOR[c.accessibility_review_status] }]}><Text style={[styles.tagText, { color: A11Y_COLOR[c.accessibility_review_status] }]}>a11y {c.accessibility_review_status}</Text></View>
                </View>
              </View>
              <Text style={styles.rMeta}>owner {c.owner}</Text>
              <View style={styles.actRow}>
                {c.accessibility_review_status !== "passed" ? <Pressable testID={`design-a11y-pass-${c.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#27AE60" }]} onPress={() => patch(c.id, { accessibility_review_status: "passed" })}><Text style={[styles.smallBtnText, { color: "#27AE60" }]}>Pass a11y</Text></Pressable> : null}
                {c.status !== "approved" ? <Pressable testID={`design-approve-${c.id}`} disabled={busy} style={styles.smallBtn} onPress={() => patch(c.id, { status: "approved" })}><Text style={styles.smallBtnText}>Approve</Text></Pressable> : null}
                {c.status !== "deprecated" ? <Pressable testID={`design-deprecate-${c.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => patch(c.id, { status: "deprecated" })}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Deprecate</Text></Pressable> : null}
                <Pressable testID={`design-delete-${c.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => remove(c.id)}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Delete</Text></Pressable>
              </View>
            </View>
          ))}
        </>
      )}

      {tab === "registry" && (registry.registry || []).map((r: any) => (
        <View key={r.key} style={styles.card}>
          <Text style={styles.rTitle}>{r.label}</Text>
          <Text style={styles.rMeta}>{r.key} · {r.category}</Text>
        </View>
      ))}

      {tab === "safety" && (registry.safety_statuses || []).map((s: any) => (
        <View key={s.key} style={[styles.card, { borderLeftColor: s.color, borderLeftWidth: 3 }]}>
          <View style={styles.labelRow}>
            <Text style={styles.rTitle}>{s.label}</Text>
            <MaterialCommunityIcons name={s.icon as any} size={18} color={s.color} />
          </View>
          <Text style={styles.rMeta}>{s.description}</Text>
          {s.blocks_monetization ? <Text style={[styles.rMeta, { color: colors.warning }]}>Suppresses promotional / rewards / affiliate content.</Text> : null}
        </View>
      ))}
      {tab === "registry" ? <Text style={styles.note}>New features must reuse these components first. New components require accessibility review before approval.</Text> : null}
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
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
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  addRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: "center" },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tagRow: { flexDirection: "row", gap: spacing.xs },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, flexShrink: 1 },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  actRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
