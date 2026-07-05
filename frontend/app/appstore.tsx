import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Integration = { id: string; slug: string; name: string; category: string; publisher: string; pricing: string; price_label: string; description: string; capabilities: string[]; scopes: string[]; icon: string; installed?: boolean };

export default function AppStore() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Integration[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Integration | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ integrations: Integration[]; categories: string[] }>("/appstore");
      setItems(d.integrations); setCats(d.categories);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = cat ? items.filter((i) => i.category === cat) : items;

  const install = async (i: Integration) => {
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api(`/appstore/${i.slug}/install`, { method: "POST" });
      Alert.alert("Connected ✓", `${i.name} can now access: ${i.scopes.join(", ")}. You can revoke access anytime.`);
      setOpen(null); await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const uninstall = async (i: Integration) => {
    setBusy(true);
    try { await api(`/appstore/${i.slug}/uninstall`, { method: "POST" }); setOpen(null); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="store-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Integrations</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <Text style={styles.help}>Connect trusted add-ons to extend DIYhomie. Every integration clearly shows what it can access — and you can revoke it instantly.</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
            <Pressable testID="store-cat-all" style={[styles.chip, !cat && styles.chipOn]} onPress={() => setCat(null)}><Text style={[styles.chipText, !cat && styles.chipTextOn]}>All</Text></Pressable>
            {cats.map((c) => (
              <Pressable key={c} testID={`store-cat-${c}`} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}><Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{c}</Text></Pressable>
            ))}
          </ScrollView>

          {shown.map((i) => (
            <Pressable key={i.slug} testID={`store-item-${i.slug}`} style={styles.card} onPress={() => setOpen(i)}>
              <View style={styles.iconBox}><MaterialCommunityIcons name={i.icon as any} size={24} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.name} numberOfLines={1}>{i.name}</Text>
                  {i.installed && <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />}
                </View>
                <Text style={styles.pub}>{i.publisher} · {i.price_label}</Text>
                <Text style={styles.desc} numberOfLines={2}>{i.description}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!open} animationType="slide" transparent onRequestClose={() => setOpen(null)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{open?.name}</Text>
              <Pressable testID="store-close" hitSlop={10} onPress={() => setOpen(null)}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView>
              <Text style={styles.pub}>{open?.publisher} · {open?.price_label}{open?.pricing === "paid" ? " · Paid add-on" : ""}</Text>
              <Text style={styles.desc}>{open?.description}</Text>
              <Text style={styles.blockLabel}>What it does</Text>
              {open?.capabilities.map((c, i) => (
                <View key={i} style={styles.bullet}><MaterialCommunityIcons name="check" size={15} color={colors.success} /><Text style={styles.bulletText}>{c}</Text></View>
              ))}
              <Text style={styles.blockLabel}>Permissions requested</Text>
              <View style={styles.permBox}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.warning} />
                <Text style={styles.permText}>{open?.scopes.join(", ") || "None"}</Text>
              </View>
              <Text style={styles.transparency}>Reviewed & permissioned by DIYhomie. No data is shared without your explicit consent, and you can revoke access at any time.</Text>
            </ScrollView>
            {open?.installed ? (
              <Pressable testID="store-uninstall" style={[styles.btn, styles.btnDanger]} onPress={() => uninstall(open)} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.error} /> : <Text style={[styles.btnText, { color: colors.error }]}>Disconnect & revoke access</Text>}
              </Pressable>
            ) : (
              <Pressable testID="store-install" style={styles.btn} onPress={() => open && install(open)} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Connect this integration</Text>}
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  help: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 12, textTransform: "capitalize" },
  chipTextOn: { color: colors.onBrandPrimary },
  card: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  iconBox: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  pub: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 18 },
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "86%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sheetTitle: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  blockLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  bullet: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 6 },
  bulletText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  permBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.sm, padding: spacing.md },
  permText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  transparency: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.md, lineHeight: 16 },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  btnDanger: { backgroundColor: "transparent", borderColor: colors.error, borderWidth: 1.5 },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
