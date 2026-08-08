import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_LABEL: Record<string, string> = {
  identifying: "Getting started", assessing: "Condition added", comparing: "Comparing options",
  routed: "Option chosen", completed: "Done", cancelled: "Cancelled",
};

export default function ExitHome() {
  const router = useRouter();
  const [cases, setCases] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, cfg] = await Promise.all([api("/hi/exit/cases"), api("/hi/exit/config")]);
      setCases(c.cases || []);
      setCategories(cfg.categories || []);
      if (!cat && (cfg.categories || []).length) setCat(cfg.categories[0]);
    } catch {} finally { setLoading(false); }
  }, [cat]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const start = async () => {
    if (!title.trim()) { Alert.alert("What is it?", "Tell Homie what the item is."); return; }
    setBusy(true);
    try {
      const res = await api("/hi/exit/cases", { method: "POST", body: { title: title.trim(), category: cat } });
      setOpen(false); setTitle("");
      router.push(`/home-intel/exit/${res.case.id}`);
    } catch (e: any) { Alert.alert("Couldn't start", e?.message || "Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Sell, Donate or Recycle" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Pressable testID="exit-start" style={styles.startCard} onPress={() => setOpen(true)}>
          <MaterialCommunityIcons name="tag-arrow-right-outline" size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.startTitle}>I don't need this anymore</Text>
            <Text style={styles.startSub}>Homie compares keep, sell, trade-in, donate & recycle</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color="#fff" />
        </Pressable>

        <Text style={styles.section}>Your items</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} /> :
          cases.length === 0 ? <Text style={styles.empty}>No items yet. Start with something you no longer need.</Text> :
            cases.map((c) => (
              <Pressable key={c.id} testID={`exit-case-${c.id}`} style={styles.caseRow} onPress={() => router.push(`/home-intel/exit/${c.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.caseTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.caseMeta}>{c.category} · {STATUS_LABEL[c.status] || c.status}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}

        <Text style={styles.note}>DIYhomie helps you decide and hands off to trusted partners — it never holds your money, verifies buyers, or handles payments. Values shown are estimates, not offers.</Text>
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>What are you letting go of?</Text>
            <TextInput testID="exit-title" value={title} onChangeText={setTitle} placeholder="e.g. iPhone 12, cordless drill, sofa" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              {categories.map((c) => (
                <Pressable key={c} testID={`exit-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}>
                  <Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.sheetBtns}>
              <Pressable style={[styles.sheetBtn, styles.sheetCancel]} onPress={() => setOpen(false)}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
              <Pressable testID="exit-create" disabled={busy} style={[styles.sheetBtn, styles.sheetGo]} onPress={start}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sheetGoText}>Continue</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  startCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg },
  startTitle: { color: "#fff", fontFamily: font.bold, fontSize: type.lg },
  startSub: { color: "#ffffffcc", fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  caseRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  caseTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  caseMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg, lineHeight: 18 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.md },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  chipTextOn: { color: colors.brandPrimary },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  sheetCancel: { borderColor: colors.border, borderWidth: 1 },
  sheetCancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  sheetGo: { backgroundColor: colors.brandPrimary },
  sheetGoText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
