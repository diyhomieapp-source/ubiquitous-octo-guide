import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Linking, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

type Supply = { name: string; url: string };

export default function Supplies() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Supply[]>([]);
  const [bundleUrl, setBundleUrl] = useState("");
  const [title, setTitle] = useState("");
  const [hasProject, setHasProject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pid = await storage.getItem<string>("diyhomie_active_project", "");
      if (!pid) {
        setHasProject(false);
        setItems([]);
        return;
      }
      setHasProject(true);
      const res = await api<{ items: Supply[]; bundle_url: string; project_title: string }>(`/projects/${pid}/supplies`);
      setItems(res.items);
      setBundleUrl(res.bundle_url);
      setTitle(res.project_title);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (url) Linking.openURL(url);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.h1}>PROJECT SUPPLIES</Text>
        <Text style={styles.sub}>{title ? title : "Missing tools Homie flagged for you"}</Text>
      </View>

      {/* Bark.com local pro CTA */}
      <Pressable testID="supplies-find-pro" style={styles.proCard} onPress={() => open("https://www.bark.com")}>
        <View style={styles.proIcon}>
          <MaterialCommunityIcons name="account-hard-hat" size={22} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.proTitle}>Rather hire a local pro?</Text>
          <Text style={styles.proSub}>Get competitive bids from vetted contractors near you.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
      </Pressable>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : !hasProject || items.length === 0 ? (
        <View style={styles.center} testID="supplies-empty">
          <MaterialCommunityIcons name="toolbox-outline" size={56} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>YOU'RE FULLY STOCKED</Text>
          <Text style={styles.emptySub}>
            {hasProject ? "Homie hasn’t flagged any missing tools for this project yet." : "Start a project with Homie and any missing tools will appear here."}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ gap: spacing.md, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          >
            {items.map((it) => (
              <View key={it.name} style={styles.itemRow} testID={`supply-item-${it.name}`}>
                <View style={styles.itemImg}>
                  <MaterialCommunityIcons name="wrench-outline" size={26} color={colors.onSurfaceSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <Text style={styles.itemMeta}>Matched to your project</Text>
                </View>
                <Pressable style={styles.buyBtn} onPress={() => open(it.url)}>
                  <MaterialCommunityIcons name="cart" size={16} color={colors.onBrandSecondary} />
                  <Text style={styles.buyText}>BUY</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.checkout, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable testID="supplies-buy-bundle" style={styles.bundleBtn} onPress={() => open(bundleUrl)}>
              <MaterialCommunityIcons name="amazon" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.bundleText}>BUY COMPLETE PROJECT KIT</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { marginBottom: spacing.lg },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 36, lineHeight: 38 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 2 },
  proCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  proIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  proTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  proSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1 },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 20 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1 },
  itemImg: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  itemName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  buyBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  buyText: { color: colors.onBrandSecondary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  checkout: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 },
  bundleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md },
  bundleText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
});
