import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert, Image, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Listing = { id: string; type: string; category: string; title: string; description: string; condition?: string; price_cents: number; is_donation: boolean; fulfillment?: string; region: string; image_base64?: string; status: string; owner_name: string; eco: { waste_lbs?: number; co2_kg?: number }; claims: number; is_owner: boolean };
type Meta = { categories: string[]; conditions: string[]; fulfillments: string[] };
type Tab = "browse" | "impact" | "green" | "post";

export default function Circular() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("browse");
  const [meta, setMeta] = useState<Meta | null>(null);

  useFocusEffect(useCallback(() => { api<Meta>("/circular/meta").then(setMeta).catch(() => {}); }, []));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="circ-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Materials Exchange</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={styles.tabRow}>
        {([["browse", "Browse"], ["impact", "Impact"], ["green", "Eco Finder"], ["post", "Offer / Ask"]] as [Tab, string][]).map(([k, l]) => (
          <Pressable key={k} testID={`circ-tab-${k}`} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
        {tab === "browse" && <Browse insetsBottom={insets.bottom} />}
        {tab === "impact" && <Impact insetsBottom={insets.bottom} />}
        {tab === "green" && <Green insetsBottom={insets.bottom} />}
        {tab === "post" && <PostForm meta={meta} insetsBottom={insets.bottom} onPosted={() => setTab("browse")} />}
      </View>
    </View>
  );
}

function Browse({ insetsBottom }: { insetsBottom: number }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<"offer" | "request">("offer");

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api<{ listings: Listing[] }>(`/circular/listings?type=${type}`); setListings(d.listings); } catch {} finally { setLoading(false); }
  }, [type]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const claim = async (l: Listing) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { const r = await api<{ contact?: string; already?: boolean }>(`/circular/listings/${l.id}/claim`, { method: "POST" }); Alert.alert(l.type === "offer" ? "Interest sent" : "Offer sent", r.already ? "You already reached out." : (r.contact || "Owner notified.")); } catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); }
  };
  const close = async (l: Listing) => {
    try { await api(`/circular/listings/${l.id}/close`, { method: "POST" }); load(); } catch {}
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
      <View style={styles.segRow}>
        <Pressable testID="circ-seg-offer" style={[styles.seg, type === "offer" && styles.segOn]} onPress={() => setType("offer")}><Text style={[styles.segText, type === "offer" && styles.segTextOn]}>Available ({type === "offer" ? listings.length : ""})</Text></Pressable>
        <Pressable testID="circ-seg-request" style={[styles.seg, type === "request" && styles.segOn]} onPress={() => setType("request")}><Text style={[styles.segText, type === "request" && styles.segTextOn]}>Wanted</Text></Pressable>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : listings.length === 0 ? (
        <View style={styles.empty}><MaterialCommunityIcons name="leaf-off" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>Nothing here yet — be the first to {type === "offer" ? "offer surplus materials" : "request materials"}.</Text></View>
      ) : listings.map((l) => (
        <View key={l.id} style={styles.card}>
          {l.image_base64 ? <Image source={{ uri: l.image_base64 }} style={styles.cardImg} /> : null}
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle} numberOfLines={1}>{l.title}</Text>
            <View style={[styles.priceTag, { backgroundColor: (l.is_donation ? colors.success : colors.brandPrimary) + "22" }]}>
              <Text style={[styles.priceText, { color: l.is_donation ? colors.success : colors.brandPrimary }]}>{l.is_donation ? "FREE" : money(l.price_cents)}</Text>
            </View>
          </View>
          <Text style={styles.cardMeta}>{l.category}{l.condition ? ` · ${l.condition}` : ""} · {l.fulfillment} · {l.region}</Text>
          {!!l.description && <Text style={styles.cardDesc} numberOfLines={2}>{l.description}</Text>}
          {!!(l.eco?.waste_lbs) && <Text style={styles.ecoLine}>♻︎ Saves ~{l.eco.waste_lbs} lbs waste · {l.eco.co2_kg} kg CO₂</Text>}
          <View style={styles.cardFoot}>
            <Text style={styles.owner}>{l.owner_name}</Text>
            <View style={{ flex: 1 }} />
            {l.is_owner ? (
              <Pressable testID={`circ-close-${l.id}`} style={styles.ghostBtn} onPress={() => close(l)}><Text style={styles.ghostText}>Mark given</Text></Pressable>
            ) : (
              <Pressable testID={`circ-claim-${l.id}`} style={styles.claimBtn} onPress={() => claim(l)}><Text style={styles.claimText}>{l.type === "offer" ? "I want this" : "I can help"}</Text></Pressable>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Impact({ insetsBottom }: { insetsBottom: number }) {
  const [d, setD] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { setD(await api("/circular/impact")); } catch {} finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (loading || !d) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />;
  const t = d.totals;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
      <View style={styles.impactHero}>
        <MaterialCommunityIcons name="recycle-variant" size={30} color={colors.success} />
        <Text style={styles.heroBig}>{t.waste_lbs} lbs</Text>
        <Text style={styles.heroSub}>waste diverted from landfill</Text>
      </View>
      <View style={styles.statRow}>
        <Stat value={String(t.gives)} label="Items given" />
        <Stat value={`${t.co2_kg} kg`} label="CO₂ avoided" />
        <Stat value={money(t.writeoff_cents)} label="Est. write-off" />
      </View>
      <Text style={styles.note}>{d.writeoff_note}</Text>

      {d.leaderboard?.length > 0 && (
        <>
          <Text style={styles.section}>Top givers · {d.region}</Text>
          {d.leaderboard.map((e: any) => (
            <View key={e.rank} style={[styles.lbRow, e.is_me && styles.lbMe]}>
              <Text style={styles.lbRank}>#{e.rank}</Text>
              <Text style={styles.lbName}>{e.name}{e.is_me ? " (you)" : ""}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.lbVal}>{e.gives} gives · {e.waste_lbs} lbs</Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.section}>Donate / recycle locally</Text>
      {(d.restore_directory || []).map((r: any, i: number) => (
        <View key={i} style={styles.dirRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={styles.dirName}>{r.name} · {r.type}</Text><Text style={styles.dirNote}>{r.note}</Text></View>
        </View>
      ))}
    </ScrollView>
  );
}

function Green({ insetsBottom }: { insetsBottom: number }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (query: string) => {
    setLoading(true);
    try { const d = await api<{ alternatives: any[] }>(`/circular/eco-alternatives?query=${encodeURIComponent(query)}`); setItems(d.alternatives); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(""); }, [load]));
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.onSurfaceTertiary} />
        <TextInput testID="circ-green-search" style={styles.searchInput} value={q} onChangeText={setQ} onSubmitEditing={() => load(q)} returnKeyType="search" placeholder="What are you shopping for? (paint, floor, light…)" placeholderTextColor={colors.onSurfaceTertiary} />
      </View>
      <Text style={styles.note}>Greener, certified, or reclaimed alternatives for common materials.</Text>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : items.map((it, i) => (
        <View key={i} style={styles.greenCard}>
          <MaterialCommunityIcons name="leaf" size={20} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.greenName}>{it.name}</Text>
            <Text style={styles.greenBlurb}>{it.blurb}</Text>
            <View style={styles.certRow}>
              {it.certs.map((c: string) => <View key={c} style={styles.certChip}><Text style={styles.certText}>{c}</Text></View>)}
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function PostForm({ meta, insetsBottom, onPosted }: { meta: Meta | null; insetsBottom: number; onPosted: () => void }) {
  const [type, setType] = useState<"offer" | "request">("offer");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("Other");
  const [condition, setCondition] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState("Local pickup");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) { Alert.alert("Add a title", "Describe the item in a few words."); return; }
    setBusy(true);
    try {
      await api("/circular/listings", { method: "POST", body: {
        type, title: title.trim(), description: desc.trim(), category, condition,
        fulfillment, price_cents: Math.round((parseFloat(price.replace(/[^0-9.]/g, "")) || 0) * 100),
      } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Posted!", "Your listing is live for neighbors.");
      setTitle(""); setDesc(""); setPrice(""); onPosted();
    } catch (e: any) { Alert.alert("Couldn't post", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
        <View style={styles.segRow}>
          <Pressable testID="circ-post-offer" style={[styles.seg, type === "offer" && styles.segOn]} onPress={() => setType("offer")}><Text style={[styles.segText, type === "offer" && styles.segTextOn]}>Offer / donate</Text></Pressable>
          <Pressable testID="circ-post-request" style={[styles.seg, type === "request" && styles.segOn]} onPress={() => setType("request")}><Text style={[styles.segText, type === "request" && styles.segTextOn]}>Request</Text></Pressable>
        </View>
        <TextInput testID="circ-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Title (e.g. 20 sq ft leftover subway tile)" placeholderTextColor={colors.onSurfaceTertiary} />
        <TextInput style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} placeholder="Details — quantity, condition, pickup notes" placeholderTextColor={colors.onSurfaceTertiary} multiline />
        <Text style={styles.miniLabel}>CATEGORY</Text>
        <View style={styles.chipWrap}>
          {(meta?.categories || []).map((c) => <Pressable key={c} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
        </View>
        {type === "offer" && (
          <>
            <Text style={styles.miniLabel}>CONDITION</Text>
            <View style={styles.chipWrap}>
              {(meta?.conditions || []).map((c) => <Pressable key={c} style={[styles.chip, condition === c && styles.chipOn]} onPress={() => setCondition(c)}><Text style={[styles.chipText, condition === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
            </View>
          </>
        )}
        <Text style={styles.miniLabel}>FULFILLMENT</Text>
        <View style={styles.chipWrap}>
          {(meta?.fulfillments || []).map((c) => <Pressable key={c} style={[styles.chip, fulfillment === c && styles.chipOn]} onPress={() => setFulfillment(c)}><Text style={[styles.chipText, fulfillment === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
        </View>
        {type === "offer" && (
          <>
            <Text style={styles.miniLabel}>PRICE (LEAVE BLANK TO DONATE FREE)</Text>
            <TextInput testID="circ-price" style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="$0 (free)" placeholderTextColor={colors.onSurfaceTertiary} />
          </>
        )}
        <Pressable testID="circ-submit" style={styles.submitBtn} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Post to neighborhood</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tabRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11 },
  tabTextOn: { color: colors.onBrandPrimary },
  segRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  seg: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  segOn: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  segText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  segTextOn: { color: colors.surface },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardImg: { width: "100%", height: 120, borderRadius: radius.sm, backgroundColor: colors.surface, marginBottom: spacing.xs },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  priceTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  priceText: { fontFamily: font.bold, fontSize: 11 },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  cardDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  ecoLine: { color: colors.success, fontFamily: font.medium, fontSize: type.sm },
  cardFoot: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  owner: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  claimBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  claimText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  ghostBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  ghostText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  impactHero: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.success, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, gap: 2, marginBottom: spacing.md },
  heroBig: { color: colors.success, fontFamily: font.display, fontSize: 38 },
  heroSub: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  statRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, textAlign: "center" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, fontStyle: "italic", marginVertical: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.xs },
  lbMe: { borderColor: colors.brandPrimary },
  lbRank: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 16, width: 30 },
  lbName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  lbVal: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  dirRow: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  dirName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  dirNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  greenCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  greenName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  greenBlurb: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  certRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  certChip: { backgroundColor: colors.success + "22", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  certText: { color: colors.success, fontFamily: font.bold, fontSize: 10 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.sm },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginBottom: spacing.xs, marginTop: spacing.xs },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
