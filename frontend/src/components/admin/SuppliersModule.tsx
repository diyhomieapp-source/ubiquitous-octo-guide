import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const CATEGORIES = ["Lumber", "Building Materials", "Electrical", "Plumbing", "Paint", "Landscaping", "Roofing", "Tools"];
const ORDER_STATUSES = ["rfq", "quoted", "confirmed", "fulfilled", "cancelled"];
const SC: Record<string, string> = { rfq: colors.info, quoted: colors.warning, confirmed: colors.brandPrimary, fulfilled: colors.success, cancelled: colors.error };

type Supplier = { id: string; name: string; categories: string[]; location: string; pro_only: boolean; blurb: string; min_order_cents: number; delivery: boolean; pickup: boolean; active: boolean; product_count: number; order_count: number };
type OItem = { name: string; qty: number; unit: string; grade?: string; cut_length?: string; unit_price_cents: number; line_cents: number };
type Order = { id: string; user_id: string; supplier_name: string; mode: string; fulfillment: string; status: string; items: OItem[]; subtotal_cents: number; quoted_cents?: number | null; note: string; updated_at: string };

export function SuppliersModule() {
  const [tab, setTab] = useState<"suppliers" | "orders">("orders");
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.tabRow}>
        <Pressable testID="sup-tab-orders" style={[styles.tab, tab === "orders" && styles.tabOn]} onPress={() => setTab("orders")}>
          <Text style={[styles.tabText, tab === "orders" && styles.tabTextOn]}>RFQs & Orders</Text>
        </Pressable>
        <Pressable testID="sup-tab-suppliers" style={[styles.tab, tab === "suppliers" && styles.tabOn]} onPress={() => setTab("suppliers")}>
          <Text style={[styles.tabText, tab === "suppliers" && styles.tabTextOn]}>Suppliers</Text>
        </Pressable>
      </View>
      {tab === "orders" ? <OrdersTab /> : <SuppliersTab />}
    </View>
  );
}

// ---------------------------------------------------------------- Orders / RFQs
function OrdersTab() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try { setRows(await api<Order[]>("/admin/material-orders")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const pending = rows.filter((r) => r.status === "rfq").length;

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <Text style={styles.h1}>RFQs & Orders</Text>
      <Text style={styles.sub}>{rows.length} orders · {pending} quote requests awaiting response.</Text>
      <View style={styles.filterRow}>
        {["all", ...ORDER_STATUSES].map((s) => (
          <Pressable key={s} testID={`ord-filter-${s}`} style={[styles.filter, filter === s && styles.filterActive]} onPress={() => setFilter(s)}>
            <Text style={[styles.filterText, filter === s && styles.filterTextActive]}>{s.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <View style={styles.empty}><MaterialCommunityIcons name="clipboard-text-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No orders in this view.</Text></View>
      ) : shown.map((o) => <OrderCard key={o.id} order={o} reload={load} />)}
    </ScrollView>
  );
}

function OrderCard({ order, reload }: { order: Order; reload: () => void }) {
  const total = order.quoted_cents || order.subtotal_cents;
  const [quote, setQuote] = useState(String(Math.round((order.quoted_cents || order.subtotal_cents || 0) / 100)));
  const [busy, setBusy] = useState(false);

  const update = async (status: string, quotedCents?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      let path = `/admin/material-orders/${order.id}?status=${status}`;
      if (quotedCents != null) path += `&quoted_cents=${quotedCents}`;
      await api(path, { method: "PATCH" });
      reload();
    } catch (e: any) { Alert.alert("Update failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const sendQuote = () => {
    const cents = Math.round((parseFloat(quote.replace(/[^0-9.]/g, "")) || 0) * 100);
    if (cents <= 0) { Alert.alert("Enter a quote", "Provide a quoted total greater than $0."); return; }
    update("quoted", cents);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.oName}>{order.supplier_name}</Text>
        <View style={[styles.badge, { backgroundColor: (SC[order.status] || colors.onSurfaceTertiary) + "22" }]}>
          <Text style={[styles.badgeText, { color: SC[order.status] || colors.onSurfaceTertiary }]}>{order.status}</Text>
        </View>
      </View>
      <Text style={styles.meta}>{order.mode === "rfq" ? "Quote request" : "Order"} · {order.fulfillment} · {order.items.length} item(s)</Text>
      {order.items.slice(0, 4).map((it, i) => (
        <Text key={i} style={styles.lineItem}>• {it.qty} {it.unit} {it.name}{it.grade ? ` (${it.grade})` : ""}{it.cut_length ? ` · ${it.cut_length}` : ""}</Text>
      ))}
      {order.items.length > 4 && <Text style={styles.lineItem}>+{order.items.length - 4} more…</Text>}
      {!!order.note && <Text style={styles.note}>“{order.note}”</Text>}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{order.quoted_cents ? "Quoted" : "Est. subtotal"}</Text>
        <Text style={styles.totalAmt}>{money(total)}</Text>
      </View>

      {(order.status === "rfq" || order.status === "quoted") && (
        <View style={styles.quoteRow}>
          <View style={styles.quoteInputWrap}>
            <Text style={styles.dollar}>$</Text>
            <TextInput testID={`ord-quote-${order.id}`} style={styles.quoteInput} value={quote} onChangeText={setQuote} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
          </View>
          <Pressable testID={`ord-sendquote-${order.id}`} style={[styles.btn, styles.btnOk]} onPress={sendQuote} disabled={busy}>
            <MaterialCommunityIcons name="send-outline" size={14} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{order.status === "quoted" ? "Re-quote" : "Send quote"}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.actions}>
        {order.status !== "confirmed" && order.status !== "fulfilled" && order.status !== "cancelled" && (
          <Pressable testID={`ord-confirm-${order.id}`} style={styles.btn} onPress={() => update("confirmed")} disabled={busy}>
            <MaterialCommunityIcons name="check-circle-outline" size={14} color={colors.brandPrimary} /><Text style={[styles.btnText, { color: colors.brandPrimary }]}>Confirm</Text>
          </Pressable>
        )}
        {order.status !== "fulfilled" && order.status !== "cancelled" && (
          <Pressable testID={`ord-fulfill-${order.id}`} style={styles.btn} onPress={() => update("fulfilled")} disabled={busy}>
            <MaterialCommunityIcons name="truck-check-outline" size={14} color={colors.success} /><Text style={[styles.btnText, { color: colors.success }]}>Fulfilled</Text>
          </Pressable>
        )}
        {order.status !== "cancelled" && order.status !== "fulfilled" && (
          <Pressable testID={`ord-cancel-${order.id}`} style={styles.btn} onPress={() => update("cancelled")} disabled={busy}>
            <MaterialCommunityIcons name="close-circle-outline" size={14} color={colors.error} /><Text style={[styles.btnText, { color: colors.error }]}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Suppliers
function SuppliersTab() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api<Supplier[]>("/admin/suppliers")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (s: Supplier) => {
    try { await api(`/admin/suppliers/${s.id}/toggle?active=${!s.active}`, { method: "POST" }); load(); } catch {}
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Suppliers</Text>
          <Text style={styles.sub}>{rows.length} suppliers · {rows.filter((r) => r.active).length} active.</Text>
        </View>
        <Pressable testID="sup-add-toggle" style={[styles.btn, styles.btnOk]} onPress={() => setAdding((a) => !a)}>
          <MaterialCommunityIcons name={adding ? "close" : "plus"} size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{adding ? "Close" : "Add"}</Text>
        </Pressable>
      </View>

      {adding && <AddSupplierForm onCreated={() => { setAdding(false); load(); }} />}

      {rows.map((s) => <SupplierCard key={s.id} supplier={s} toggle={() => toggle(s)} reload={load} />)}
    </ScrollView>
  );
}

function SupplierCard({ supplier, toggle, reload }: { supplier: Supplier; toggle: () => void; reload: () => void }) {
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const doImport = async () => {
    if (!csv.trim() || importing) return;
    setImporting(true);
    try {
      const r = await api<{ added: number }>(`/admin/suppliers/${supplier.id}/products/import`, { method: "POST", body: { csv } });
      Alert.alert("Import complete", `${r.added} product(s) added.`);
      setCsv(""); setShowImport(false); reload();
    } catch (e: any) { Alert.alert("Import failed", e?.message || "Check CSV format."); }
    finally { setImporting(false); }
  };

  return (
    <View style={[styles.card, !supplier.active && { opacity: 0.6 }]}>
      <View style={styles.cardTop}>
        <Text style={styles.oName}>{supplier.name}</Text>
        {supplier.pro_only && <View style={styles.proTag}><Text style={styles.proTagText}>PRO</Text></View>}
        <View style={{ flex: 1 }} />
        <Pressable testID={`sup-toggle-${supplier.id}`} style={[styles.switch, supplier.active && styles.switchOn]} onPress={toggle}>
          <View style={[styles.knob, supplier.active && styles.knobOn]} />
        </Pressable>
      </View>
      <Text style={styles.meta}>{supplier.categories.join(", ") || "—"} · {supplier.location || "—"}</Text>
      {!!supplier.blurb && <Text style={styles.blurb} numberOfLines={2}>{supplier.blurb}</Text>}
      <Text style={styles.meta}>Min {money(supplier.min_order_cents)} · {supplier.product_count} products · {supplier.order_count} orders · {supplier.delivery ? "Delivery" : ""}{supplier.delivery && supplier.pickup ? " + " : ""}{supplier.pickup ? "Pickup" : ""}</Text>

      <Pressable testID={`sup-import-toggle-${supplier.id}`} style={styles.linkBtn} onPress={() => setShowImport((v) => !v)}>
        <MaterialCommunityIcons name="file-upload-outline" size={14} color={colors.brandPrimary} /><Text style={styles.linkText}>{showImport ? "Hide import" : "Import products (CSV)"}</Text>
      </Pressable>
      {showImport && (
        <View>
          <Text style={styles.hint}>One product per line: sku,name,unit,price</Text>
          <TextInput testID={`sup-csv-${supplier.id}`} style={styles.csvInput} value={csv} onChangeText={setCsv} placeholder={"2x4-8,2x4 Stud 8ft,ea,4.98\nplywd-12,Plywood 1/2in 4x8,sheet,42.50"} placeholderTextColor={colors.onSurfaceTertiary} multiline />
          <Pressable testID={`sup-import-${supplier.id}`} style={[styles.btn, styles.btnOk, { alignSelf: "flex-start" }]} onPress={doImport} disabled={importing}>
            {importing ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><MaterialCommunityIcons name="upload" size={14} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Import</Text></>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AddSupplierForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [blurb, setBlurb] = useState("");
  const [min, setMin] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [proOnly, setProOnly] = useState(true);
  const [delivery, setDelivery] = useState(true);
  const [pickup, setPickup] = useState(true);
  const [stripeAcct, setStripeAcct] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) { if (!name.trim()) Alert.alert("Name required", "Enter a supplier name."); return; }
    setBusy(true);
    try {
      await api("/admin/suppliers", { method: "POST", body: {
        name: name.trim(), categories: cats, location: location.trim(), blurb: blurb.trim(),
        min_order_cents: Math.round((parseFloat(min.replace(/[^0-9.]/g, "")) || 0) * 100),
        pro_only: proOnly, delivery, pickup,
        stripe_account_id: stripeAcct.trim() || null,
      } });
      onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const toggleCat = (c: string) => setCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  return (
    <View style={styles.form}>
      <TextInput testID="new-sup-name" style={styles.input} value={name} onChangeText={setName} placeholder="Supplier name *" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="new-sup-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="Location / service area" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={styles.input} value={min} onChangeText={setMin} keyboardType="decimal-pad" placeholder="Minimum order ($)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]} value={blurb} onChangeText={setBlurb} placeholder="Short blurb" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <TextInput testID="new-sup-stripe" style={styles.input} value={stripeAcct} onChangeText={setStripeAcct} autoCapitalize="none" placeholder="Stripe Connect account id (acct_…) — optional, enables online pay" placeholderTextColor={colors.onSurfaceTertiary} />
      <Text style={styles.miniLabel}>CATEGORIES</Text>
      <View style={styles.chipWrap}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} style={[styles.chip, cats.includes(c) && styles.chipOn]} onPress={() => toggleCat(c)}>
            <Text style={[styles.chipText, cats.includes(c) && styles.chipTextOn]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chipWrap}>
        <Toggle label="Pro only" on={proOnly} onPress={() => setProOnly((v) => !v)} />
        <Toggle label="Delivery" on={delivery} onPress={() => setDelivery((v) => !v)} />
        <Toggle label="Pickup" on={pickup} onPress={() => setPickup((v) => !v)} />
      </View>
      <Pressable testID="new-sup-create" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={create} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><MaterialCommunityIcons name="check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Create supplier</Text></>}
      </Pressable>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <MaterialCommunityIcons name={on ? "check" : "close"} size={12} color={on ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  scroll: { paddingBottom: spacing["3xl"] },
  tabRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.onBrandPrimary },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  filterActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  filterText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  filterTextActive: { color: colors.surface },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  oName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  blurb: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  lineItem: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", marginTop: 2 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs, paddingTop: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1 },
  totalLabel: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  totalAmt: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  quoteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  quoteInputWrap: { flexDirection: "row", alignItems: "center", flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  dollar: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.base },
  quoteInput: { flex: 1, paddingVertical: 8, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  btnText: { fontFamily: font.bold, fontSize: type.sm },
  proTag: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 9 },
  switch: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  csvInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, minHeight: 70, textAlignVertical: "top", color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, marginVertical: spacing.xs },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginTop: spacing.xs },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
});
