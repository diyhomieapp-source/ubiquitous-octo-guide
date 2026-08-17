import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState } from "@/src/components/ui";

const STATUS_META: Record<string, { label: string; icon: string; color: string }> = {
  undecided: { label: "Decide", icon: "help-circle-outline", color: colors.onSurfaceTertiary },
  have_it: { label: "Have it", icon: "check-circle", color: colors.success },
  will_buy: { label: "Buy", icon: "cart-outline", color: colors.brandPrimary },
  will_borrow: { label: "Borrow", icon: "hand-extended-outline", color: colors.info },
  will_rent: { label: "Rent", icon: "key-outline", color: "#B388FF" },
  need_verification: { label: "Verify", icon: "magnify", color: colors.warning },
  skipped: { label: "Skip", icon: "close-circle-outline", color: colors.onSurfaceTertiary },
};
const CYCLE = ["have_it", "will_buy", "will_borrow", "will_rent", "need_verification", "skipped", "undecided"];

export default function ReadinessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/readiness/issues/${id}`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    setBusy("gen");
    try { setData({ ...(data || {}), ...(await api<any>(`/hi/readiness/issues/${id}/generate`, { method: "POST" })), has_plan: true }); }
    catch (e: any) { Alert.alert("Couldn't build the list", e?.message || ""); }
    finally { setBusy(""); }
  };

  const cycleStatus = async (item: any) => {
    const next = CYCLE[(CYCLE.indexOf(item.status) + 1) % CYCLE.length];
    setBusy(item.id);
    try { setData({ ...(data || {}), ...(await api<any>(`/hi/readiness/items/${item.id}/status`, { method: "POST", body: { status: next } })) }); }
    catch {} finally { setBusy(""); }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setBusy("ask");
    try {
      setAnswer(await api<any>(`/hi/readiness/issues/${id}/ask`, { method: "POST", body: { question: question.trim() } }));
      setQuestion("");
    } catch (e: any) { Alert.alert("Couldn't check", e?.message || ""); }
    finally { setBusy(""); }
  };

  const bom = data?.bom;
  const summary = data?.summary;
  const proc = data?.procurement;
  const money = (v: any) => (v == null ? "—" : `$${Number(v).toFixed(0)}`);

  const ItemRow = ({ item }: { item: any }) => {
    const m = STATUS_META[item.status] || STATUS_META.undecided;
    return (
      <View testID={`rd-item-${item.id}`} style={styles.itemRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.itemHead}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.requirement === "required" ? <View style={styles.reqChip}><Text style={styles.reqText}>required</Text></View> : null}
            {item.requirement === "unknown" ? <View style={[styles.reqChip, { borderColor: colors.warning }]}><Text style={[styles.reqText, { color: colors.warning }]}>unclear</Text></View> : null}
          </View>
          {item.purpose ? <Text style={styles.itemMeta}>{item.purpose}</Text> : null}
          <Text style={styles.itemMeta}>
            {item.kind}{item.qty_estimate ? ` · ~${item.qty_estimate}${item.unit ? ` ${item.unit}` : ""}` : ""}
            {item.cost_low != null || item.cost_high != null ? ` · ${money(item.cost_low)}–${money(item.cost_high)}` : " · price varies"}
            {` · ${item.confidence} confidence`}
          </Text>
          {item.inventory_match ? (
            <View style={styles.matchRow}>
              <MaterialCommunityIcons name="toolbox-outline" size={13} color={colors.success} />
              <Text style={styles.matchText}>In your toolbox: {item.inventory_match.inventory_name}{item.inventory_match.exact ? "" : " (verify it fits)"}</Text>
            </View>
          ) : null}
          {item.substitute_hint ? <Text style={styles.subHint}>Substitute: {item.substitute_hint}</Text> : null}
        </View>
        <Pressable testID={`rd-status-${item.id}`} onPress={() => cycleStatus(item)} style={[styles.statusBtn, { borderColor: m.color }]}>
          {busy === item.id ? <ActivityIndicator size="small" color={m.color} /> : (
            <>
              <MaterialCommunityIcons name={m.icon as any} size={16} color={m.color} />
              <Text style={[styles.statusText, { color: m.color }]}>{m.label}</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rd-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Materials & Budget</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {data?.issue?.description ? <Text style={styles.intro} numberOfLines={2}>{data.issue.description}</Text> : null}

          {!bom ? (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>{"Know before you spend"}</Text>
              <Text style={styles.actionBody}>{"I'll build the full list this project needs, check it against your toolbox, and give you an honest cost range with its assumptions — before you buy anything."}</Text>
              {!data?.has_plan ? <Text style={styles.warnText}>Create a repair plan first — the list is grounded in it.</Text> : null}
              <Button testID="rd-generate" label="Build my readiness list" icon="clipboard-check-outline" loading={busy === "gen"} disabled={!data?.has_plan} onPress={generate} />
            </View>
          ) : (
            <>
              {data?.stale ? (
                <Pressable testID="rd-refresh" onPress={generate} style={styles.staleBanner}>
                  <MaterialCommunityIcons name="refresh-circle" size={18} color={colors.warning} />
                  <Text style={styles.staleText}>Your plan changed since this list was built — tap to rebuild (your choices are kept).</Text>
                </Pressable>
              ) : null}

              {/* Readiness summary */}
              <View style={styles.sumCard}>
                <View style={styles.sumRow}>
                  <View style={styles.sumCol}>
                    <Text testID="rd-readiness-pct" style={styles.sumBig}>{summary?.readiness_pct}%</Text>
                    <Text style={styles.sumLabel}>ready (required items you have)</Text>
                  </View>
                  <View style={styles.sumCol}>
                    <Text style={styles.sumBig}>{money(summary?.to_spend_low)}–{money(summary?.to_spend_high)}</Text>
                    <Text style={styles.sumLabel}>honest cost range to acquire the rest</Text>
                  </View>
                </View>
                <View style={styles.progBar}><View style={[styles.progFill, { width: `${summary?.readiness_pct || 0}%` }]} /></View>
                <Text style={styles.sumMeta}>{summary?.ready_required}/{summary?.required_items} required items on hand · {summary?.verify_count} to verify</Text>
                <Pressable testID="rd-assumptions" onPress={() => setShowAssumptions(!showAssumptions)} style={styles.assumeBtn}>
                  <MaterialCommunityIcons name={showAssumptions ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
                  <Text style={styles.assumeText}>What this estimate assumes</Text>
                </Pressable>
                {showAssumptions ? (
                  <View style={styles.assumeBox}>
                    {(summary?.cost_assumptions || []).map((a: string, i: number) => <Text key={i} style={styles.assumeItem}>• {a}</Text>)}
                    <Text style={styles.disclaimer}>{summary?.disclaimer}</Text>
                  </View>
                ) : null}
              </View>

              {/* Items */}
              <Text style={styles.sectionTitle}>Everything this project needs (tap the chip to decide)</Text>
              {(bom.items || []).map((it: any) => <ItemRow key={it.id} item={it} />)}

              {/* Procurement lists */}
              {proc && (proc.buy.length || proc.borrow.length || proc.rent.length || proc.verify.length) ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Your prep lists</Text>
                  {[["buy", "Shopping list", "cart-outline"], ["borrow", "To borrow", "hand-extended-outline"], ["rent", "To rent", "key-outline"], ["verify", "Verify before buying", "magnify"]].map(([k, label, icon]) => (
                    (proc as any)[k as string].length ? (
                      <View key={k as string} style={styles.procCard}>
                        <View style={styles.procHead}><MaterialCommunityIcons name={icon as any} size={16} color={colors.brandPrimary} /><Text style={styles.procTitle}>{label as string} ({(proc as any)[k as string].length})</Text></View>
                        {(proc as any)[k as string].map((p: any) => (
                          <Text key={p.id} style={styles.procItem}>• {p.name}{p.qty ? ` (~${p.qty}${p.unit ? ` ${p.unit}` : ""})` : ""}{p.cost_low != null ? ` — ${money(p.cost_low)}–${money(p.cost_high)}` : ""}</Text>
                        ))}
                      </View>
                    ) : null
                  ))}
                </View>
              ) : null}

              {/* Compatibility / substitute Q&A */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Not sure something fits?</Text>
                <Text style={styles.itemMeta}>{`Ask before you buy — e.g. "Can I use a 3/4-inch fitting instead of 1/2-inch?"`}</Text>
                <View style={styles.qRow}>
                  <TextInput testID="rd-ask-input" value={question} onChangeText={setQuestion} placeholder="Ask a compatibility question…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.qInput} />
                  <Pressable testID="rd-ask-send" onPress={ask} style={styles.qSend}>
                    {busy === "ask" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="send" size={18} color={colors.onBrandPrimary} />}
                  </Pressable>
                </View>
                {answer ? (
                  <View testID="rd-answer" style={[styles.answerCard, answer.affects_safety && { borderColor: colors.warning }]}>
                    <View style={styles.procHead}>
                      <MaterialCommunityIcons name={answer.verdict === "compatible" ? "check-circle" : answer.verdict === "not_compatible" ? "close-circle" : "alert-circle-outline"} size={16} color={answer.verdict === "compatible" ? colors.success : answer.verdict === "not_compatible" ? colors.error : colors.warning} />
                      <Text style={styles.procTitle}>{answer.verdict.replace(/_/g, " ")}</Text>
                    </View>
                    <Text style={styles.answerText}>{answer.answer}</Text>
                    {(answer.what_to_verify || []).map((v: string, i: number) => <Text key={i} style={styles.procItem}>✓ {v}</Text>)}
                    {answer.affects_safety ? <Text style={styles.warnText}>⚠️ This choice affects safety — verify before proceeding.</Text> : null}
                  </View>
                ) : null}
              </View>
            </>
          )}
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
  actionCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  actionTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  actionBody: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  warnText: { fontFamily: font.medium, fontSize: type.sm, color: colors.warning },
  staleBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.warning },
  staleText: { flex: 1, fontFamily: font.medium, fontSize: type.sm, color: colors.warning },
  sumCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  sumRow: { flexDirection: "row", gap: spacing.lg },
  sumCol: { flex: 1 },
  sumBig: { fontFamily: font.display, fontSize: type["2xl"], color: colors.onSurface },
  sumLabel: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  progBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progFill: { height: 6, backgroundColor: colors.success },
  sumMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  assumeBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  assumeText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  assumeBox: { gap: 4, paddingTop: spacing.xs },
  assumeItem: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  disclaimer: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, fontStyle: "italic", marginTop: spacing.xs },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  section: { gap: spacing.sm },
  itemRow: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  itemHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  itemName: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  reqChip: { borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  reqText: { fontFamily: font.medium, fontSize: 10, color: colors.brandPrimary },
  itemMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  matchText: { fontFamily: font.medium, fontSize: type.sm, color: colors.success },
  subHint: { fontFamily: font.regular, fontSize: type.sm, color: colors.info, marginTop: 2 },
  statusBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 92, justifyContent: "center" },
  statusText: { fontFamily: font.medium, fontSize: type.sm },
  procCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  procHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  procTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  procItem: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  qRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  qInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: font.regular, fontSize: type.base },
  qSend: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  answerCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  answerText: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
});
