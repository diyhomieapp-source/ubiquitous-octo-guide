import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type KitCard = {
  slug: string; name: string; category: string; icon: string; tagline: string; difficulty: string;
  est_hours: number; timeline_days: number; featured: boolean; component_count: number;
  step_count: number; price_from_cents: number; price_full_cents: number;
};
type Component = { id: string; name: string; kind: string; qty: number; unit: string; price_cents: number; affiliate_url: string | null; optional: boolean; default_on: boolean; eco: boolean };
type Upsell = { id: string; name: string; description: string; price_cents: number };
type KitDetail = KitCard & { description: string; components: Component[]; upsells: Upsell[]; steps: { title: string; instruction: string; phase: string }[] };
type Order = { id: string; kit_name: string; icon: string; project_id: string; status: string; manifest: any; total_steps: number; done_steps: number; progress: number; leftovers_listed?: boolean };

const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const DIFF_COLOR: Record<string, string> = { Beginner: "#27AE60", Intermediate: "#2F80ED", Advanced: "#EB5757" };

export default function Kits() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [kits, setKits] = useState<KitCard[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meta, list, mine] = await Promise.all([
        api<{ categories: string[] }>("/kits/meta"),
        api<{ kits: KitCard[] }>("/kits"),
        api<{ orders: Order[] }>("/kits/orders/mine"),
      ]);
      setCats(["All", ...meta.categories]); setKits(list.kits); setOrders(mine.orders);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    return kits.filter((k) => (cat === "All" || k.category === cat) && (!q || (k.name + k.tagline).toLowerCase().includes(q.toLowerCase())));
  }, [kits, cat, q]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="kits-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Project Kits</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable testID="kits-tab-browse" style={[styles.tab, tab === "browse" && styles.tabOn]} onPress={() => setTab("browse")}><Text style={[styles.tabText, tab === "browse" && styles.tabTextOn]}>Browse Kits</Text></Pressable>
        <Pressable testID="kits-tab-mine" style={[styles.tab, tab === "mine" && styles.tabOn]} onPress={() => setTab("mine")}><Text style={[styles.tabText, tab === "mine" && styles.tabTextOn]}>My Kits{orders.length ? ` (${orders.length})` : ""}</Text></Pressable>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {tab === "browse" ? (
            <>
              <View style={styles.searchRow}>
                <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceTertiary} />
                <TextInput testID="kits-search" style={styles.search} value={q} onChangeText={setQ} placeholder="Search kits…" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {cats.map((c) => (
                  <Pressable key={c} testID={`kits-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}>
                    <Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {filtered.map((k) => (
                <Pressable key={k.slug} testID={`kit-${k.slug}`} style={styles.card} onPress={() => setDetail(k.slug)}>
                  <View style={styles.cardTop}>
                    <View style={styles.iconWrap}><MaterialCommunityIcons name={k.icon as any} size={24} color={colors.brandPrimary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kitName}>{k.name}</Text>
                      <Text style={styles.tagline} numberOfLines={2}>{k.tagline}</Text>
                    </View>
                    {k.featured && <View style={styles.featured}><Text style={styles.featuredText}>★</Text></View>}
                  </View>
                  <View style={styles.metaRow}>
                    <View style={[styles.diff, { backgroundColor: (DIFF_COLOR[k.difficulty] || colors.onSurfaceTertiary) + "22" }]}>
                      <Text style={[styles.diffText, { color: DIFF_COLOR[k.difficulty] || colors.onSurfaceTertiary }]}>{k.difficulty}</Text>
                    </View>
                    <Text style={styles.meta}>~{k.est_hours}h · {k.step_count} steps</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.price}>from {usd(k.price_from_cents)}</Text>
                  </View>
                </Pressable>
              ))}
              {filtered.length === 0 && <Text style={styles.empty}>No kits match. Try another category.</Text>}
            </>
          ) : (
            <>
              {orders.length === 0 && <Text style={styles.empty}>No kits started yet. Browse the catalog to start your first DIY-in-a-box.</Text>}
              {orders.map((o) => (
                <View key={o.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.iconWrap}><MaterialCommunityIcons name={(o.icon || "package-variant") as any} size={24} color={colors.brandPrimary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kitName}>{o.kit_name}</Text>
                      <Text style={styles.meta}>{o.status === "arrived" ? "Kit arrived — build in progress" : "Ordered"} · {o.done_steps}/{o.total_steps} steps</Text>
                    </View>
                    <Text style={styles.price}>{usd((o.manifest || {}).subtotal_cents || 0)}</Text>
                  </View>
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${o.progress}%` }]} /></View>
                  <View style={styles.orderActions}>
                    <Pressable testID={`kit-open-${o.id}`} style={[styles.smallBtn, styles.smallBtnOk]} onPress={() => router.push(`/project/${o.project_id}`)}><Text style={styles.smallBtnOkText}>Open guide</Text></Pressable>
                    {o.status !== "arrived" && <OrderAction id={o.id} label="Kit arrived" path="arrived" onDone={load} />}
                    <LeftoverButton order={o} onDone={load} />
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {detail && <KitSheet slug={detail} onClose={() => setDetail(null)} onStarted={(pid) => { setDetail(null); load(); router.push(`/project/${pid}`); }} />}
    </View>
  );
}

function OrderAction({ id, label, path, onDone }: { id: string; label: string; path: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api(`/kits/orders/${id}/${path}`, { method: "POST" }); onDone(); } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); } };
  return <Pressable testID={`kit-${path}-${id}`} style={styles.smallBtn} onPress={go} disabled={busy}>{busy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.smallBtnText}>{label}</Text>}</Pressable>;
}

function LeftoverButton({ order, onDone }: { order: Order; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const list = async () => {
    const items = (order.manifest?.items || []).filter((i: any) => i.kind === "material").slice(0, 6).map((i: any) => ({ title: `Leftover: ${i.name}`, category: "Other" }));
    if (items.length === 0) { Alert.alert("Nothing to list", "No leftover materials found for this kit."); return; }
    setBusy(true);
    try { const r = await api<{ listed: number }>(`/kits/orders/${order.id}/leftover`, { method: "POST", body: { items } }); Alert.alert("Listed to Materials Exchange", `${r.listed} leftover item(s) offered free to neighbors.`); onDone(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  if (order.leftovers_listed) return <View style={styles.smallBtn}><Text style={styles.smallBtnText}>Leftovers listed ✓</Text></View>;
  return <Pressable testID={`kit-leftover-${order.id}`} style={styles.smallBtn} onPress={list} disabled={busy}>{busy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.smallBtnText}>List leftovers</Text>}</Pressable>;
}

function KitSheet({ slug, onClose, onStarted }: { slug: string; onClose: () => void; onStarted: (projectId: string) => void }) {
  const insets = useSafeAreaInsets();
  const [kit, setKit] = useState<KitDetail | null>(null);
  const [optOn, setOptOn] = useState<Record<string, boolean>>({});
  const [upOn, setUpOn] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const k = await api<KitDetail>(`/kits/${slug}`);
      setKit(k);
      const o: Record<string, boolean> = {};
      k.components.forEach((c) => { if (c.optional) o[c.id] = !!c.default_on; });
      setOptOn(o);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); }
  }, [slug]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const optionIds = useMemo(() => Object.keys(optOn).filter((k) => optOn[k]), [optOn]);
  const upsellIds = useMemo(() => Object.keys(upOn).filter((k) => upOn[k]), [upOn]);

  const subtotal = useMemo(() => {
    if (!kit) return 0;
    let s = 0;
    kit.components.forEach((c) => { if (!c.optional || optOn[c.id]) s += c.price_cents * (c.qty || 1); });
    kit.upsells.forEach((u) => { if (upOn[u.id]) s += u.price_cents; });
    return s;
  }, [kit, optOn, upOn]);

  const start = async () => {
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await api<{ project_id: string }>(`/kits/${slug}/start`, { method: "POST", body: { option_ids: optionIds, upsell_ids: upsellIds } });
      Alert.alert("Project started 🎉", "Your kit is added to My Projects with the full AR/step guide. Buy the materials via the links, and tap 'Kit arrived' when they land.");
      onStarted(r.project_id);
    } catch (e: any) { Alert.alert("Couldn't start", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (!kit) return <View style={styles.overlay}><View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}><ActivityIndicator color={colors.brandPrimary} /></View></View>;

  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, maxHeight: "88%" }]}>
        <View style={styles.sheetHead}>
          <View style={styles.iconWrap}><MaterialCommunityIcons name={kit.icon as any} size={24} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kitName}>{kit.name}</Text>
            <Text style={styles.meta}>{kit.category} · ~{kit.est_hours}h · {kit.timeline_days}d</Text>
          </View>
          <Pressable testID="kit-close" onPress={onClose} hitSlop={8}><MaterialCommunityIcons name="close" size={22} color={colors.onSurface} /></Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.desc}>{kit.description}</Text>

          <Text style={styles.section}>Included ({kit.components.filter((c) => !c.optional).length})</Text>
          {kit.components.filter((c) => !c.optional).map((c) => (
            <View key={c.id} style={styles.compRow}>
              <MaterialCommunityIcons name={c.kind === "tool" ? "wrench-outline" : c.kind === "safety" ? "shield-check-outline" : "cube-outline"} size={16} color={colors.onSurfaceTertiary} />
              <Text style={styles.compName}>{c.name}{c.qty !== 1 ? ` ×${c.qty}` : ""}{c.eco ? " 🌱" : ""}</Text>
              <Text style={styles.compPrice}>{usd(c.price_cents * (c.qty || 1))}</Text>
            </View>
          ))}

          {kit.components.some((c) => c.optional) && <Text style={styles.section}>Add-ons</Text>}
          {kit.components.filter((c) => c.optional).map((c) => (
            <Pressable key={c.id} testID={`kit-opt-${c.id}`} style={styles.compRow} onPress={() => setOptOn((s) => ({ ...s, [c.id]: !s[c.id] }))}>
              <View style={[styles.check, optOn[c.id] && styles.checkOn]}>{optOn[c.id] && <MaterialCommunityIcons name="check" size={13} color={colors.onBrandPrimary} />}</View>
              <Text style={styles.compName}>{c.name}{c.qty !== 1 ? ` ×${c.qty}` : ""}{c.eco ? " 🌱" : ""}</Text>
              <Text style={styles.compPrice}>+{usd(c.price_cents * (c.qty || 1))}</Text>
            </Pressable>
          ))}

          {kit.upsells.length > 0 && <Text style={styles.section}>Upgrade your project</Text>}
          {kit.upsells.map((u) => (
            <Pressable key={u.id} testID={`kit-upsell-${u.id}`} style={styles.compRow} onPress={() => setUpOn((s) => ({ ...s, [u.id]: !s[u.id] }))}>
              <View style={[styles.check, upOn[u.id] && styles.checkOn]}>{upOn[u.id] && <MaterialCommunityIcons name="check" size={13} color={colors.onBrandPrimary} />}</View>
              <View style={{ flex: 1 }}><Text style={styles.compName}>{u.name}</Text><Text style={styles.upDesc}>{u.description}</Text></View>
              <Text style={styles.compPrice}>+{usd(u.price_cents)}</Text>
            </Pressable>
          ))}

          <Text style={styles.section}>AR / step plan ({kit.steps.length})</Text>
          {kit.steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.compName}>{s.title}</Text><Text style={styles.upDesc}>{s.instruction}</Text></View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <View>
            <Text style={styles.footerLabel}>Smart Table total</Text>
            <Text style={styles.footerTotal}>{usd(subtotal)}</Text>
          </View>
          <Pressable testID="kit-start" style={styles.startBtn} onPress={start} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="rocket-launch-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.startText}>Start this project</Text></>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tabRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.onBrandPrimary },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, borderColor: colors.border, borderWidth: 1 },
  search: { flex: 1, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chipRow: { gap: spacing.xs, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  kitName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  tagline: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  featured: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandPrimary + "22", alignItems: "center", justifyContent: "center" },
  featuredText: { color: colors.brandPrimary, fontSize: 13 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  diff: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  diffText: { fontFamily: font.bold, fontSize: 10 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  price: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl, lineHeight: 20 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
  orderActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  smallBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  smallBtnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  smallBtnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  smallBtnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.lg, marginBottom: spacing.xs },
  compRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderBottomColor: colors.border, borderBottomWidth: 1 },
  compName: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  compPrice: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  upDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15 },
  check: { width: 22, height: 22, borderRadius: 6, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.xs },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  stepNumText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingTop: spacing.md, marginTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  footerLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11 },
  footerTotal: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  startBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  startText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
