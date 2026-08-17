import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Platform, Share } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

const COMPAT_META: Record<string, { label: string; color: string; icon: string }> = {
  confirmed_fit: { label: "Confirmed fit", color: colors.success, icon: "check-decagram" },
  verify_fit: { label: "Verify fit", color: colors.warning, icon: "magnify" },
  alternative: { label: "Alternative", color: colors.info, icon: "swap-horizontal" },
};
const FULFILL = [
  { key: "buy", label: "Buy", icon: "cart-outline" },
  { key: "use_owned", label: "Use owned", icon: "toolbox-outline" },
  { key: "borrow", label: "Borrow", icon: "hand-extended-outline" },
  { key: "rent", label: "Rent", icon: "key-outline" },
  { key: "professional_supply", label: "Pro supplies", icon: "account-hard-hat" },
];

export default function ProjectMarket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [options, setOptions] = useState<Record<string, any[]>>({});
  const [openItem, setOpenItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/market/issues/${id}/entry`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadOptions = async (itemId: string) => {
    if (openItem === itemId) { setOpenItem(null); return; }
    setOpenItem(itemId);
    if (options[itemId]) return;
    setBusy("opt" + itemId);
    try { const r = await api<any>(`/hi/market/items/${itemId}/options`, { method: "POST" }); setOptions((s) => ({ ...s, [itemId]: r.options })); }
    catch (e: any) { Alert.alert("No options right now", e?.message || ""); setOpenItem(null); }
    finally { setBusy(""); }
  };

  const select = async (itemId: string, fulfillment: string) => {
    setBusy("sel" + itemId + fulfillment);
    try { await api(`/hi/market/items/${itemId}/select`, { method: "POST", body: { fulfillment } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const openRetailer = async (optionId: string, retailer: string) => {
    setBusy("out" + optionId + retailer);
    try {
      const r = await api<any>("/hi/market/outbound", { method: "POST", body: { option_id: optionId, retailer } });
      await Linking.openURL(r.url);
    } catch (e: any) { Alert.alert("Couldn't open", e?.message || ""); }
    finally { setBusy(""); }
  };

  const cartStatus = async (entryId: string, status: string) => {
    setBusy("cs" + entryId);
    try { await api(`/hi/market/cart/${entryId}/status`, { method: "POST", body: { status } }); await load(); }
    catch {} finally { setBusy(""); }
  };

  const exportCart = async () => {
    setBusy("export");
    try {
      const r = await api<any>(`/hi/market/issues/${id}/cart/export`);
      if (Platform.OS === "web") { try { await (navigator as any).clipboard?.writeText(r.export_text); Alert.alert("List copied"); } catch { Alert.alert("Shopping list", r.export_text.slice(0, 600)); } }
      else await Share.share({ message: r.export_text });
    } catch {} finally { setBusy(""); }
  };

  const toggleConsent = async () => {
    const next = !data?.preferences?.attribution_consent;
    try { await api("/hi/market/preferences", { method: "PUT", body: { attribution_consent: next } }); await load(); } catch {}
  };

  const money = (v: any) => (v == null ? "?" : `$${Number(v).toFixed(0)}`);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="mk-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Get What You Need</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : !data ? null : data.gated ? (
        <View style={styles.gatedWrap}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={36} color={colors.brandPrimary} />
          <Text style={styles.gatedText}>{data.message}</Text>
          <Pressable testID="mk-goto-readiness" onPress={() => router.replace(`/home-intel/repair/readiness/${id}` as any)} style={styles.gatedBtn}>
            <Text style={styles.gatedBtnText}>Build the list first</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {data.issue?.description ? <Text style={styles.intro} numberOfLines={2}>{data.issue.description}</Text> : null}

          <View style={[styles.readyCard, { borderColor: data.project_ready ? colors.success : colors.warning }]}>
            <MaterialCommunityIcons name={data.project_ready ? "check-decagram" : "progress-clock"} size={20} color={data.project_ready ? colors.success : colors.warning} />
            <Text style={styles.readyText}>
              {data.project_ready ? "Every essential is resolved — you're ready to work." : `Still unresolved: ${data.essentials_unresolved.join(", ")}`}
            </Text>
          </View>

          <Text style={styles.disclosure}>{data.disclosure}</Text>
          <Pressable testID="mk-consent" onPress={toggleConsent} style={styles.consentRow}>
            <MaterialCommunityIcons name={data.preferences?.attribution_consent ? "checkbox-marked" : "checkbox-blank-outline"} size={18} color={colors.brandPrimary} />
            <Text style={styles.consentText}>Allow affiliate attribution (recommendations never change either way)</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Your project needs</Text>
          {data.requirements.map((q: any) => (
            <View key={q.bom_item_id} testID={`mk-req-${q.bom_item_id}`} style={[styles.reqCard, q.resolved && { opacity: 0.65 }]}>
              <View style={styles.reqHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqName}>{q.resolved ? "✓ " : ""}{q.name}</Text>
                  <Text style={styles.reqMeta}>
                    {q.requirement}{q.needs_verification ? " · verify before buying" : ""}
                    {q.cost_low != null ? ` · ~${money(q.cost_low)}–${money(q.cost_high)}` : ""}
                    {q.cart_entry ? ` · ${q.cart_entry.fulfillment.replace(/_/g, " ")} (${q.cart_entry.status})` : ""}
                  </Text>
                </View>
                {!q.resolved ? (
                  <Pressable testID={`mk-options-${q.bom_item_id}`} onPress={() => loadOptions(q.bom_item_id)} style={styles.optBtn}>
                    {busy === "opt" + q.bom_item_id ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.optBtnText}>{openItem === q.bom_item_id ? "Hide" : "Options"}</Text>}
                  </Pressable>
                ) : null}
                {q.cart_entry && q.cart_entry.status === "saved" ? (
                  <Pressable testID={`mk-got-${q.bom_item_id}`} onPress={() => cartStatus(q.cart_entry.id, q.cart_entry.fulfillment === "buy" ? "purchased" : "obtained")} style={[styles.optBtn, { borderColor: colors.success }]}>
                    {busy === "cs" + q.cart_entry.id ? <ActivityIndicator size="small" color={colors.success} /> : <Text style={[styles.optBtnText, { color: colors.success }]}>Got it</Text>}
                  </Pressable>
                ) : null}
              </View>

              {/* Fulfillment paths */}
              {!q.resolved && openItem === q.bom_item_id ? (
                <View style={styles.fulfillRow}>
                  {FULFILL.map((f) => (
                    <Pressable key={f.key} testID={`mk-ful-${q.bom_item_id}-${f.key}`} onPress={() => select(q.bom_item_id, f.key)} style={[styles.fulfillChip, q.cart_entry?.fulfillment === f.key && styles.fulfillOn]}>
                      {busy === "sel" + q.bom_item_id + f.key ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
                        <>
                          <MaterialCommunityIcons name={f.icon as any} size={13} color={q.cart_entry?.fulfillment === f.key ? colors.onBrandTertiary : colors.onSurfaceSecondary} />
                          <Text style={[styles.fulfillText, q.cart_entry?.fulfillment === f.key && { color: colors.onBrandTertiary }]}>{f.label}</Text>
                        </>
                      )}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Options */}
              {openItem === q.bom_item_id && options[q.bom_item_id] ? options[q.bom_item_id].map((o: any) => {
                const cm = COMPAT_META[o.compatibility] || COMPAT_META.verify_fit;
                return (
                  <View key={o.id} testID={`mk-opt-${o.id}`} style={styles.optionCard}>
                    <View style={styles.optionHead}>
                      <Text style={styles.optionName}>{o.name}</Text>
                      <View style={[styles.compatChip, { borderColor: cm.color }]}>
                        <MaterialCommunityIcons name={cm.icon as any} size={12} color={cm.color} />
                        <Text style={[styles.compatText, { color: cm.color }]}>{cm.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.optionWhy}>{o.why_recommended}</Text>
                    <Text style={styles.optionBasis}>Basis: {o.compatibility_basis}</Text>
                    {(o.needs_verification || []).map((v: string, i: number) => <Text key={i} style={styles.verifyText}>✓ {v}</Text>)}
                    {o.tradeoff ? <Text style={styles.tradeoff}>Tradeoff: {o.tradeoff}</Text> : null}
                    <Text style={styles.optionPrice}>{o.price_low != null ? `~${money(o.price_low)}–${money(o.price_high)}` : "Price varies"}</Text>
                    <View style={styles.retailRow}>
                      {(o.retailer_links || []).map((l: any) => (
                        <Pressable key={l.retailer} testID={`mk-out-${o.id}-${l.retailer}`} onPress={() => openRetailer(o.id, l.retailer)} style={styles.retailBtn}>
                          {busy === "out" + o.id + l.retailer ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.retailText}>{l.label} ↗</Text>}
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              }) : null}
            </View>
          ))}

          {data.cart?.length ? (
            <Pressable testID="mk-export" onPress={exportCart} style={styles.exportBtn}>
              {busy === "export" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                <>
                  <MaterialCommunityIcons name="export-variant" size={18} color={colors.onBrandPrimary} />
                  <Text style={styles.exportText}>Export shopping list ({data.cart.length})</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontFamily: font.display, fontSize: type.xl, color: colors.onSurface, letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  intro: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurfaceTertiary },
  gatedWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  gatedText: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  gatedBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  gatedBtnText: { fontFamily: font.bold, fontSize: type.base, color: colors.onBrandPrimary },
  readyCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1 },
  readyText: { flex: 1, fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  disclosure: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  consentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  consentText: { flex: 1, fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  reqCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  reqHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reqName: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  reqMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  optBtn: { borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  optBtnText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  fulfillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fulfillChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  fulfillOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  fulfillText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  optionCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  optionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  optionName: { flex: 1, fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  compatChip: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontFamily: font.medium, fontSize: 10 },
  optionWhy: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  optionBasis: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  verifyText: { fontFamily: font.medium, fontSize: type.sm, color: colors.warning },
  tradeoff: { fontFamily: font.regular, fontSize: type.sm, color: colors.info },
  optionPrice: { fontFamily: font.bold, fontSize: type.sm, color: colors.onSurface },
  retailRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 4 },
  retailBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  retailText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  exportText: { fontFamily: font.bold, fontSize: type.base, color: colors.onBrandPrimary },
});
