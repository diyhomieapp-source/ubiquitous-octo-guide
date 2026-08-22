import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Mat = {
  id: string; name: string; category: string; quantity: string; unit: string; why?: string;
  user_status: string; purchase_status?: string; estimated_price?: number | null; actual_price?: number | null;
  quantity_basis?: string; inventory_match?: { name: string } | null; owned?: boolean;
};
type Tab = "needed" | "owned" | "purchased" | "tools" | "receipts";
const TABS: { key: Tab; label: string }[] = [
  { key: "needed", label: "Needed" }, { key: "owned", label: "Owned" }, { key: "purchased", label: "Purchased" },
  { key: "tools", label: "Tools" }, { key: "receipts", label: "Receipts" },
];
const STATUS_OPTS: { key: string; label: string }[] = [
  { key: "have_it", label: "Own it" }, { key: "need_it", label: "Need to buy" },
  { key: "need_to_rent", label: "Rent" }, { key: "need_to_borrow", label: "Borrow" },
  { key: "not_required", label: "Skip" },
];
const BASIS_LABEL: Record<string, string> = { measured: "Measured", estimated: "Estimated", user_entered: "User-entered" };

export default function MaterialsWorkspace() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("needed");
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  // quantity calc modal
  const [calcFor, setCalcFor] = useState<Mat | null>(null);
  const [calcArea, setCalcArea] = useState("");
  const [calcCoats, setCalcCoats] = useState("2");
  const [calcResult, setCalcResult] = useState<any>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  // substitution modal
  const [subFor, setSubFor] = useState<Mat | null>(null);
  const [subOwned, setSubOwned] = useState("");
  const [subResult, setSubResult] = useState<any>(null);
  const [subBusy, setSubBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/hi/materials/projects/${id}/workspace`);
      setData(d);
      const r = await api(`/hi/materials/projects/${id}/purchase-readiness`);
      setReadiness(r);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (mid: string, user_status: string) => {
    try { await api(`/hi/materials/items/${mid}`, { method: "PUT", body: { user_status } }); load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
  };

  const matchInventory = async () => {
    setMatching(true);
    try {
      const res = await api<{ counts: { already_have: number; need_to_buy: number } }>(`/hi/inventory/match/${id}/apply`, { method: "POST", body: { apply: true } });
      load();
      Alert.alert("Toolbox matched", `${res.counts.already_have} you already have · ${res.counts.need_to_buy} to buy.`);
    } catch (e: any) { Alert.alert("Couldn't match", e?.message || "Add items to your toolbox first."); }
    finally { setMatching(false); }
  };

  const runCalc = async () => {
    if (!calcFor) return;
    setCalcBusy(true);
    try {
      const body: any = { material_id: calcFor.id, calc_type: "paint", coats: parseInt(calcCoats, 10) || 2 };
      if (calcArea.trim()) body.area_sqft = parseFloat(calcArea);
      const res = await api(`/hi/materials/projects/${id}/quantity-calc`, { method: "POST", body });
      setCalcResult(res);
    } catch (e: any) { Alert.alert("Couldn't calculate", e?.message || "Try again."); }
    finally { setCalcBusy(false); }
  };

  const runSub = async () => {
    if (!subFor || !subOwned.trim()) return;
    setSubBusy(true);
    try {
      const res = await api(`/hi/materials/projects/${id}/substitution-check`, {
        method: "POST", body: { required_name: subFor.name, owned_name: subOwned.trim(), material_id: subFor.id },
      });
      setSubResult(res);
    } catch (e: any) { Alert.alert("Couldn't check", e?.message || "Try again."); }
    finally { setSubBusy(false); }
  };

  const useAnyway = async () => {
    if (!subResult) return;
    try {
      await api(`/hi/materials/substitutions/${subResult.id}/use-anyway`, { method: "POST", body: {} });
      setSubFor(null); setSubResult(null); setSubOwned(""); load();
    } catch (e: any) { Alert.alert("Not allowed", e?.detail || e?.message || "This substitution is prohibited."); }
  };

  const markToolOwned = async (m: Mat) => {
    try {
      await api(`/hi/materials/projects/${id}/tools/${m.id}/own`, { method: "POST", body: { add_to_inventory: true } });
      load();
    } catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Materials" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const tabs = data.tabs || {};
  const items: Mat[] = tabs[tab] || [];
  const SUB_COLOR: Record<string, string> = {
    safe_substitute: colors.success, verify_first: colors.warning,
    not_recommended: colors.error, prohibited: colors.error,
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={data.project?.title || "Materials"} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* summary header */}
        <View style={styles.summary}>
          <Text testID="mat-ready-count" style={styles.readyText}>Ready: {data.ready.resolved} of {data.ready.total} items</Text>
          <Text style={styles.budgetText}>
            Estimated: ${data.budget.estimated_items_total}{data.budget.actual_purchased_total > 0 ? ` · Purchased: $${data.budget.actual_purchased_total}` : ""}
          </Text>
        </View>

        {/* readiness card */}
        {readiness && (
          <View style={[styles.readyCard, { borderColor: readiness.ready ? colors.success : colors.warning }]}>
            <Text style={[styles.readyTitle, { color: readiness.ready ? colors.success : colors.warning }]}>
              {readiness.ready ? "Ready to start" : "Not ready yet"}
            </Text>
            {readiness.checks.map((c: any) => (
              <View key={c.check_id} style={styles.checkRow}>
                <MaterialCommunityIcons name={c.ok || c.overridden ? "check-circle-outline" : "close-circle-outline"} size={16}
                  color={c.ok || c.overridden ? colors.success : (c.safety_critical ? colors.error : colors.warning)} />
                <Text style={styles.checkText}>{c.label}{c.overridden ? " (continuing without)" : ""}</Text>
              </View>
            ))}
            {readiness.safety_blockers?.length > 0 && (
              <Text testID="mat-safety-note" style={styles.safetyNote}>Safety items can&apos;t be skipped: {readiness.safety_blockers.join(", ")}</Text>
            )}
          </View>
        )}

        <View style={styles.actionRow}>
          <Pressable testID="mat-shopping-mode" style={styles.primaryBtn} onPress={() => router.push(`/home-intel/projects/shopping?id=${id}`)}>
            <MaterialCommunityIcons name="cart-outline" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.primaryText}>Shopping Mode</Text>
          </Pressable>
          <Pressable testID="match-toolbox" style={styles.secondaryBtn} disabled={matching} onPress={matchInventory}>
            {matching ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.secondaryText}>Match toolbox</Text>}
          </Pressable>
        </View>

        {/* tabs */}
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable key={t.key} testID={`mat-tab-${t.key}`} style={[styles.tabBtn, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "receipts" ? (
          <>
            {(tabs.receipts || []).length === 0 && <Text style={styles.empty}>No receipts yet — upload them from Shopping Mode.</Text>}
            {(tabs.receipts || []).map((rc: any) => (
              <View key={rc.id} style={styles.card}>
                <Text style={styles.name}>{rc.merchant || "Receipt"}{rc.total != null ? ` · $${rc.total}` : ""}</Text>
                <Text style={styles.why}>{rc.purchase_date || ""} · {rc.status === "confirmed" ? "Confirmed" : "Needs review"} · Read confidence: {rc.confidence}</Text>
              </View>
            ))}
          </>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Nothing here yet.</Text>
        ) : items.map((m) => (
          <View key={m.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.name}>{m.name}</Text>
              {!!(m.quantity || m.unit) && (
                <Text style={styles.qty}>{m.quantity} {m.unit}{m.quantity_basis ? ` · ${BASIS_LABEL[m.quantity_basis] || m.quantity_basis}` : ""}</Text>
              )}
            </View>
            {!!m.why && <Text style={styles.why}>{m.why}</Text>}
            {m.actual_price != null && <Text style={styles.price}>Paid ${m.actual_price}</Text>}
            {tab === "tools" ? (
              <View style={styles.statusRow}>
                {m.owned || m.user_status === "have_it" ? (
                  <Text style={styles.ownedText}>
                    <MaterialCommunityIcons name="check" size={14} color={colors.success} /> You own this{m.inventory_match ? ` (${m.inventory_match.name})` : ""}
                  </Text>
                ) : (
                  <Pressable testID={`tool-own-${m.id}`} style={styles.ownBtn} onPress={() => markToolOwned(m)}>
                    <Text style={styles.ownBtnText}>I own this</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                <View style={styles.statusRow}>
                  {STATUS_OPTS.map((s) => (
                    <Pressable key={s.key} testID={`mat-${m.id}-${s.key}`}
                      style={[styles.statusBtn, m.user_status === s.key && styles.statusActive]}
                      onPress={() => setStatus(m.id, s.key)}>
                      <Text style={[styles.statusText, m.user_status === s.key && { color: colors.brandPrimary }]}>{s.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {tab === "needed" && (
                  <View style={styles.helperRow}>
                    <Pressable testID={`mat-calc-${m.id}`} style={styles.helperBtn}
                      onPress={() => { setCalcFor(m); setCalcResult(null); setCalcArea(""); setCalcCoats("2"); }}>
                      <MaterialCommunityIcons name="calculator-variant-outline" size={14} color={colors.brandPrimary} />
                      <Text style={styles.helperText}>How much?</Text>
                    </Pressable>
                    <Pressable testID={`mat-sub-${m.id}`} style={styles.helperBtn}
                      onPress={() => { setSubFor(m); setSubResult(null); setSubOwned(""); }}>
                      <MaterialCommunityIcons name="swap-horizontal" size={14} color={colors.brandPrimary} />
                      <Text style={styles.helperText}>Substitute?</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </View>
        ))}
      </ScrollView>

      {/* quantity calc modal */}
      <Modal visible={!!calcFor} transparent animationType="slide" onRequestClose={() => setCalcFor(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>How much “{calcFor?.name}”?</Text>
            <TextInput testID="calc-area" style={styles.input} placeholder="Area in sq ft (leave blank to use saved measurements)"
              placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" value={calcArea} onChangeText={setCalcArea} />
            <TextInput testID="calc-coats" style={styles.input} placeholder="Coats (paint only)"
              placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" value={calcCoats} onChangeText={setCalcCoats} />
            {calcResult && (
              <View style={styles.calcResult}>
                <Text testID="calc-result" style={styles.calcQty}>{calcResult.recommended_quantity} {calcResult.unit}(s)</Text>
                <Text style={styles.calcBasis}>Basis: {calcResult.basis_label}</Text>
                {calcResult.assumptions.map((a: string, i: number) => <Text key={i} style={styles.calcAssume}>• {a}</Text>)}
                {calcResult.requires_confirmation && <Text style={styles.safetyNote}>Estimated only — confirm the area before buying.</Text>}
              </View>
            )}
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => { setCalcFor(null); if (calcResult) load(); }}><Text style={styles.cancelText}>Close</Text></Pressable>
              <Pressable testID="calc-run" style={styles.saveBtn} disabled={calcBusy} onPress={runCalc}>
                {calcBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Calculate</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* substitution modal */}
      <Modal visible={!!subFor} transparent animationType="slide" onRequestClose={() => setSubFor(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Substitute for “{subFor?.name}”</Text>
            <TextInput testID="sub-owned" style={styles.input} placeholder="What do you have instead?"
              placeholderTextColor={colors.onSurfaceTertiary} value={subOwned} onChangeText={setSubOwned} />
            {subResult && (
              <View style={[styles.calcResult, { borderColor: SUB_COLOR[subResult.classification] || colors.border }]}>
                <Text testID="sub-verdict" style={[styles.calcQty, { color: SUB_COLOR[subResult.classification] || colors.onSurface }]}>
                  {{ safe_substitute: "Safe substitute", verify_first: "Possible — verify first",
                     not_recommended: "Not recommended", prohibited: "Prohibited" }[subResult.classification as string] || subResult.classification}
                </Text>
                <Text style={styles.calcAssume}>{subResult.explanation}</Text>
                {(subResult.verify_steps || []).map((v: string, i: number) => <Text key={i} style={styles.calcAssume}>• {v}</Text>)}
              </View>
            )}
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setSubFor(null)}><Text style={styles.cancelText}>Close</Text></Pressable>
              {subResult && subResult.classification !== "prohibited" && subResult.classification !== "not_recommended" ? (
                <Pressable testID="sub-use-anyway" style={styles.saveBtn} onPress={useAnyway}>
                  <Text style={styles.saveText}>Use it</Text>
                </Pressable>
              ) : (
                <Pressable testID="sub-run" style={styles.saveBtn} disabled={subBusy || !subOwned.trim()} onPress={runSub}>
                  {subBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Check</Text>}
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  summary: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  readyText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  budgetText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  readyCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: spacing.xs, backgroundColor: colors.surfaceSecondary },
  readyTitle: { fontFamily: font.bold, fontSize: type.base },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  checkText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, flex: 1 },
  safetyNote: { color: colors.error, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  primaryBtn: { flex: 1, flexDirection: "row", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  secondaryBtn: { flex: 1, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  tabRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1 },
  tabActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "18" },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  tabTextActive: { color: colors.brandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  qty: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  why: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  price: { color: colors.success, fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  statusBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: spacing.sm },
  statusActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "18" },
  statusText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  helperRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  helperBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  helperText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  ownedText: { color: colors.success, fontFamily: font.medium, fontSize: type.sm },
  ownBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: spacing.md },
  ownBtnText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.md },
  modalWrap: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.sm },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  calcResult: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  calcQty: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  calcBasis: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  calcAssume: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  modalBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  saveBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
