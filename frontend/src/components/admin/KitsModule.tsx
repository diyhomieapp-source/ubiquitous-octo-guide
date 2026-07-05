import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type KitRow = { slug: string; name: string; category: string; icon: string; tagline: string; difficulty: string; est_hours: number; component_count: number; step_count: number; price_from_cents: number; active: boolean; order_count: number; featured: boolean };
type Comp = { name: string; kind: string; qty: string; price: string; optional: boolean };
type Step = { title: string; instruction: string };

const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function KitsModule() {
  const [rows, setRows] = useState<KitRow[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [totals, setTotals] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, an] = await Promise.all([
        api<{ kits: KitRow[]; categories: string[] }>("/admin/kits"),
        api<{ totals: any; top_kits: any[] }>("/admin/kits/analytics"),
      ]);
      setRows(list.kits); setCats(list.categories); setTotals(an.totals);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (slug: string) => { try { await api(`/admin/kits/${slug}/toggle`, { method: "POST" }); load(); } catch {} };
  const remove = async (slug: string) => { try { await api(`/admin/kits/${slug}`, { method: "DELETE" }); load(); } catch {} };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Project Kits</Text>
          <Text style={styles.sub}>Turnkey DIY-in-a-box bundles. Launch new kit flows with no deploy.</Text>
        </View>
        <Pressable testID="kit-add-toggle" style={[styles.btn, styles.btnOk]} onPress={() => setAdding((a) => !a)}>
          <MaterialCommunityIcons name={adding ? "close" : "plus"} size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{adding ? "Close" : "New kit"}</Text>
        </Pressable>
      </View>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Kits" value={String(totals.kits)} />
          <Stat label="Active" value={String(totals.active)} />
          <Stat label="Orders" value={String(totals.orders)} />
          <Stat label="Completed" value={`${totals.completion_pct}%`} />
          <Stat label="GMV" value={usd(totals.gmv_cents)} />
        </View>
      )}

      {adding && <AddKit categories={cats} onCreated={() => { setAdding(false); load(); }} />}

      {rows.map((k) => (
        <View key={k.slug} style={styles.card}>
          <View style={styles.cardTop}>
            <MaterialCommunityIcons name={(k.icon || "toolbox-outline") as any} size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{k.name}{k.featured ? " ★" : ""}</Text>
              <Text style={styles.key}>{k.category} · {k.component_count} items · {k.step_count} steps · from {usd(k.price_from_cents)}</Text>
            </View>
            <Pressable testID={`kit-toggle-${k.slug}`} style={[styles.switch, k.active && styles.switchOn]} onPress={() => toggle(k.slug)}><View style={[styles.knob, k.active && styles.knobOn]} /></Pressable>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{k.order_count} orders · {k.difficulty}</Text>
            <View style={{ flex: 1 }} />
            <Pressable testID={`kit-del-${k.slug}`} onPress={() => remove(k.slug)} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function AddKit({ categories, onCreated }: { categories: string[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] || "General");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [hours, setHours] = useState("4");
  const [comps, setComps] = useState<Comp[]>([{ name: "", kind: "material", qty: "1", price: "0", optional: false }]);
  const [steps, setSteps] = useState<Step[]>([{ title: "", instruction: "" }]);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) { Alert.alert("Missing", "Kit name is required."); return; }
    setBusy(true);
    try {
      await api("/admin/kits", { method: "POST", body: {
        name: name.trim(), category, tagline: tagline.trim(), description: description.trim(),
        difficulty, est_hours: parseFloat(hours) || 4, timeline_days: 1, featured: false, active: true,
        components: comps.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), kind: c.kind, qty: parseFloat(c.qty) || 1, price_cents: Math.round((parseFloat(c.price) || 0) * 100), optional: c.optional, default_on: true })),
        steps: steps.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), instruction: s.instruction.trim() })),
        upsells: [],
      } });
      onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.form}>
      <TextInput testID="kit-new-name" style={styles.input} value={name} onChangeText={setName} placeholder="Kit name" placeholderTextColor={colors.onSurfaceTertiary} />
      <View style={styles.chipRow}>
        {categories.map((c) => (
          <Pressable key={c} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>
        ))}
      </View>
      <TextInput style={styles.input} value={tagline} onChangeText={setTagline} placeholder="Tagline" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={[styles.input, { minHeight: 54, textAlignVertical: "top" }]} value={description} onChangeText={setDescription} placeholder="Description" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <View style={styles.chipRow}>
        {["Beginner", "Intermediate", "Advanced"].map((d) => (
          <Pressable key={d} style={[styles.chip, difficulty === d && styles.chipOn]} onPress={() => setDifficulty(d)}><Text style={[styles.chipText, difficulty === d && styles.chipTextOn]}>{d}</Text></Pressable>
        ))}
        <TextInput style={[styles.input, { width: 90, marginBottom: 0 }]} value={hours} onChangeText={setHours} keyboardType="numeric" placeholder="hrs" placeholderTextColor={colors.onSurfaceTertiary} />
      </View>

      <Text style={styles.miniLabel}>COMPONENTS</Text>
      {comps.map((c, i) => (
        <View key={i} style={styles.rowLine}>
          <TextInput style={[styles.input, { flex: 2, marginBottom: 0 }]} value={c.name} onChangeText={(t) => setComps((s) => s.map((x, j) => j === i ? { ...x, name: t } : x))} placeholder="Item name" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput style={[styles.input, { width: 52, marginBottom: 0 }]} value={c.qty} onChangeText={(t) => setComps((s) => s.map((x, j) => j === i ? { ...x, qty: t } : x))} keyboardType="numeric" placeholder="qty" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput style={[styles.input, { width: 64, marginBottom: 0 }]} value={c.price} onChangeText={(t) => setComps((s) => s.map((x, j) => j === i ? { ...x, price: t } : x))} keyboardType="numeric" placeholder="$" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable style={[styles.tinyChip, c.kind === "tool" && styles.chipOn]} onPress={() => setComps((s) => s.map((x, j) => j === i ? { ...x, kind: x.kind === "material" ? "tool" : x.kind === "tool" ? "safety" : "material" } : x))}><Text style={[styles.chipText, c.kind === "tool" && styles.chipTextOn]}>{c.kind[0].toUpperCase()}</Text></Pressable>
        </View>
      ))}
      <Pressable testID="kit-add-comp" style={styles.linkBtn} onPress={() => setComps((s) => [...s, { name: "", kind: "material", qty: "1", price: "0", optional: false }])}><Text style={styles.linkText}>+ Add component</Text></Pressable>

      <Text style={styles.miniLabel}>STEPS</Text>
      {steps.map((s, i) => (
        <View key={i} style={styles.rowLine}>
          <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={s.title} onChangeText={(t) => setSteps((x) => x.map((y, j) => j === i ? { ...y, title: t } : y))} placeholder="Step title" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput style={[styles.input, { flex: 2, marginBottom: 0 }]} value={s.instruction} onChangeText={(t) => setSteps((x) => x.map((y, j) => j === i ? { ...y, instruction: t } : y))} placeholder="Instruction" placeholderTextColor={colors.onSurfaceTertiary} />
        </View>
      ))}
      <Pressable testID="kit-add-step" style={styles.linkBtn} onPress={() => setSteps((s) => [...s, { title: "", instruction: "" }])}><Text style={styles.linkText}>+ Add step</Text></Pressable>

      <Pressable testID="kit-new-create" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={create} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Launch kit</Text></>}
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 60, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  key: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs, paddingTop: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.xs },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginTop: spacing.sm },
  rowLine: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  tinyChip: { width: 34, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  linkBtn: { paddingVertical: spacing.xs },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
