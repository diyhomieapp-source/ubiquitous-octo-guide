import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function FinanceModule() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cash, setCash] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<any>("/admin/finance/summary"); setD(r); setCash(String((r.cash_on_hand || 0) / 100)); }
    catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addExpense = async () => {
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (!label.trim() || !cents) { Alert.alert("Finance", "Enter a label and amount."); return; }
    await api("/admin/finance/expenses", { method: "POST", body: { label: label.trim(), amount_cents: cents, cadence: "monthly" } });
    setLabel(""); setAmount(""); load();
  };
  const delExpense = async (id: string) => { await api(`/admin/finance/expenses/${id}`, { method: "DELETE" }); load(); };
  const saveCash = async () => {
    await api("/admin/finance/cash", { method: "PUT", body: { cash_on_hand_cents: Math.round(parseFloat(cash || "0") * 100) } });
    load();
  };

  if (loading || !d) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />;

  const net = d.net_monthly;
  const cards = [
    { label: "MRR", value: money(d.mrr), icon: "chart-line", accent: colors.brandPrimary },
    { label: "Revenue (this mo)", value: money(d.revenue_month), icon: "cash-multiple", accent: colors.success },
    { label: "Expenses / mo", value: money(d.monthly_expenses), icon: "cash-minus", accent: colors.error },
    { label: "Net / mo", value: money(net), icon: net >= 0 ? "trending-up" : "trending-down", accent: net >= 0 ? colors.success : colors.error },
    { label: "Margin", value: `${d.margin}%`, icon: "percent-outline", accent: colors.brandPrimary },
    { label: "ARPU", value: money(d.arpu), icon: "account-cash-outline", accent: colors.info },
    { label: "Paying users", value: `${d.paying_users}`, icon: "account-star-outline", accent: colors.info },
    { label: "Runway", value: d.runway_months ? `${d.runway_months} mo` : (net >= 0 ? "Profitable" : "—"), icon: "gas-station-outline", accent: net >= 0 ? colors.success : colors.warning },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}><Text style={styles.title}>Finance (CFO)</Text></View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={[styles.banner, { borderColor: net >= 0 ? colors.success : colors.warning }]}>
          <MaterialCommunityIcons name={net >= 0 ? "emoticon-happy-outline" : "alert-circle-outline"} size={20} color={net >= 0 ? colors.success : colors.warning} />
          <Text style={styles.bannerText}>{net >= 0 ? "You're profitable this month 🎉" : "Burning more than you earn — trim expenses or grow MRR."}</Text>
        </View>

        <View style={styles.grid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.card}>
              <MaterialCommunityIcons name={c.icon as any} size={18} color={c.accent} />
              <Text style={[styles.cardNum, { color: c.accent }]}>{c.value}</Text>
              <Text style={styles.cardLabel}>{c.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>CASH ON HAND</Text>
        <View style={styles.cashRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput testID="finance-cash-input" style={styles.cashInput} value={cash} onChangeText={setCash} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="finance-cash-save" style={styles.saveBtn} onPress={saveCash}><Text style={styles.saveText}>SAVE</Text></Pressable>
        </View>

        <Text style={styles.section}>MONTHLY EXPENSES</Text>
        <View style={styles.addRow}>
          <TextInput testID="finance-expense-label" style={[styles.input, { flex: 1 }]} value={label} onChangeText={setLabel} placeholder="e.g. Hosting, OpenAI, Stripe fees" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="finance-expense-amount" style={[styles.input, { width: 90 }]} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="$/mo" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="finance-expense-add" style={styles.addBtn} onPress={addExpense}><MaterialCommunityIcons name="plus" size={22} color={colors.onBrandPrimary} /></Pressable>
        </View>
        {(d.expenses || []).length === 0 ? (
          <Text style={styles.muted}>No expenses logged. Add your recurring costs for accurate profit.</Text>
        ) : d.expenses.map((e: any) => (
          <View key={e.id} style={styles.expRow}>
            <Text style={styles.expLabel}>{e.label}</Text>
            <Text style={styles.expAmt}>{money(e.amount_cents)}/mo</Text>
            <Pressable onPress={() => delExpense(e.id)} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>
          </View>
        ))}
        <Text style={styles.note}>Phase 2 (needs keys): auto-import bank spend (Plaid), per-API cost metering, and affiliate-partner revenue.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 30 },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, marginBottom: spacing.lg },
  bannerText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "31%", minWidth: 100, flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, gap: 2 },
  cardNum: { fontFamily: font.display, fontSize: 24 },
  cardLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm },
  cashRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dollar: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  cashInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  addBtn: { backgroundColor: colors.brandPrimary, width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  expRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginTop: spacing.sm },
  expLabel: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  expAmt: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  muted: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, fontStyle: "italic", marginTop: spacing.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xl, lineHeight: 18 },
});
