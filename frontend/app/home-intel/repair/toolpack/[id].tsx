import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  ready: { label: "Tool-ready", color: colors.success, icon: "check-decagram" },
  ready_with_alternatives: { label: "Ready with alternatives", color: colors.info, icon: "swap-horizontal" },
  missing_required: { label: "Missing required tools", color: colors.warning, icon: "toolbox-outline" },
  unsafe_tool_gap: { label: "Safety gear gap", color: colors.error, icon: "shield-alert-outline" },
};

export default function ToolPack() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [advice, setAdvice] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/tools/pack/${id}`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (name: string, checked: boolean) => {
    setBusy(name);
    try { await api(`/hi/tools/pack/${id}/check`, { method: "POST", body: { name, checked } }); await load(); }
    catch {} finally { setBusy(""); }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setBusy("ask");
    try { setAnswer(await api<any>("/hi/tools/ask", { method: "POST", body: { question: question.trim(), issue_id: id } })); setQuestion(""); }
    catch (e: any) { Alert.alert("Couldn't check", e?.message || ""); }
    finally { setBusy(""); }
  };

  const getAdvice = async (name: string) => {
    setBusy("adv" + name);
    try { const r = await api<any>("/hi/tools/procure-advice", { method: "POST", body: { tool_name: name, issue_id: id } }); setAdvice((s) => ({ ...s, [name]: r })); }
    catch (e: any) { Alert.alert("Couldn't advise", e?.message || ""); }
    finally { setBusy(""); }
  };

  const money = (v: any) => (v == null ? "?" : `$${Number(v).toFixed(0)}`);
  const st = data ? STATUS_META[data.status] || STATUS_META.missing_required : null;

  const Row = ({ item, safety }: { item: any; safety?: boolean }) => (
    <View style={styles.row}>
      <Pressable testID={`tp-check-${item.name}`} onPress={() => toggle(item.name, !item.checked)} style={styles.checkBox}>
        {busy === item.name ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
          <MaterialCommunityIcons name={item.checked || item.owned ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={item.checked || item.owned ? colors.success : colors.onSurfaceTertiary} />
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{item.name}{item.required ? "" : "  (optional)"}</Text>
        <Text style={styles.rowMeta}>
          {item.owned ? `In your toolbox: ${item.inventory_name}` : item.likely_owned ? `Maybe yours: ${item.inventory_name} — verify it fits` : "Not in your toolbox"}
          {item.source ? ` · from ${item.source}` : ""}
        </Text>
        {advice[item.name] ? (
          <View testID={`tp-advice-${item.name}`} style={styles.adviceBox}>
            <Text style={styles.adviceRec}>{advice[item.name].recommendation.toUpperCase()} — {advice[item.name].future_use} future use</Text>
            <Text style={styles.adviceText}>{advice[item.name].reasoning}</Text>
            {advice[item.name].purchase_low != null || advice[item.name].rental_day_low != null ? (
              <Text style={styles.adviceText}>
                {advice[item.name].purchase_low != null ? `Buy ~${money(advice[item.name].purchase_low)}–${money(advice[item.name].purchase_high)}` : ""}
                {advice[item.name].rental_day_low != null ? `  ·  Rent ~${money(advice[item.name].rental_day_low)}–${money(advice[item.name].rental_day_high)}/day` : ""}
              </Text>
            ) : null}
            {advice[item.name].battery_platform_note ? <Text style={styles.adviceBattery}>🔋 {advice[item.name].battery_platform_note}</Text> : null}
          </View>
        ) : null}
      </View>
      {!item.owned && !safety ? (
        <Pressable testID={`tp-adv-btn-${item.name}`} onPress={() => getAdvice(item.name)} style={styles.advBtn}>
          {busy === "adv" + item.name ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.advBtnText}>Buy/rent?</Text>}
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="tp-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Tool Pack</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : !data ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {data.issue?.description ? <Text style={styles.intro} numberOfLines={2}>{data.issue.description}</Text> : null}

          {st ? (
            <View testID="tp-status" style={[styles.statusCard, { borderColor: st.color }]}>
              <MaterialCommunityIcons name={st.icon as any} size={22} color={st.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusTitle, { color: st.color }]}>{st.label}</Text>
                <Text style={styles.statusNote}>{data.status_note}</Text>
              </View>
            </View>
          ) : null}

          {!data.has_plan ? <Text style={styles.warn}>Create a repair plan first — the tool pack comes from it.</Text> : null}
          {data.battery_platforms?.length ? <Text style={styles.battery}>🔋 Your battery platforms: {data.battery_platforms.join(", ")}</Text> : null}

          {data.safety_gear?.length ? (
            <>
              <Text style={styles.sectionTitle}>Safety gear (checked separately — tools don't protect you)</Text>
              {data.safety_gear.map((s: any) => <Row key={s.name} item={s} safety />)}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>{"Today's tools"}</Text>
          {data.tools?.length ? data.tools.map((t: any) => <Row key={t.name} item={t} />) : <Text style={styles.rowMeta}>No tools identified yet — build the Materials & Budget list first.</Text>}

          <Text style={styles.sectionTitle}>Ask about your tools</Text>
          <Text style={styles.rowMeta}>{`e.g. "Can I use my impact driver instead of a drill for this?"`}</Text>
          <View style={styles.qRow}>
            <TextInput testID="tp-ask-input" value={question} onChangeText={setQuestion} placeholder="Ask a tool question…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Pressable testID="tp-ask-send" onPress={ask} style={styles.sendBtn}>
              {busy === "ask" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="send" size={18} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
          {answer ? (
            <View testID="tp-answer" style={styles.answerCard}>
              <Text style={styles.adviceRec}>{answer.verdict.replace(/_/g, " ").toUpperCase()}</Text>
              <Text style={styles.adviceText}>{answer.answer}</Text>
              {answer.safety_note ? <Text style={styles.warn}>⚠️ {answer.safety_note}</Text> : null}
            </View>
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
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1.5 },
  statusTitle: { fontFamily: font.bold, fontSize: type.lg },
  statusNote: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  warn: { fontFamily: font.medium, fontSize: type.sm, color: colors.warning },
  battery: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "flex-start" },
  checkBox: { paddingTop: 2 },
  rowName: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  rowMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  advBtn: { borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  advBtnText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  adviceBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: 4 },
  adviceRec: { fontFamily: font.bold, fontSize: type.sm, color: colors.brandPrimary, letterSpacing: 0.5 },
  adviceText: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  adviceBattery: { fontFamily: font.medium, fontSize: type.sm, color: colors.info },
  qRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: font.regular, fontSize: type.base },
  sendBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  answerCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
});
