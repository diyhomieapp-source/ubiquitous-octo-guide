import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator, Linking, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const ORANGE = "#FF6A00";
const INK = "#111111";
const SLATE = "#444444";

type Link = { retailer: string; label: string; url: string };
type Item = { name: string; category: string; owned: boolean; links: Link[] };
type Manifest = {
  materials: Item[]; tools: Item[]; readiness: number; owned_count: number;
  total: number; bundle_url: string; project_title: string;
};

export function SupplyDrawer({ projectId, visible, onClose }: { projectId: string; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api<Manifest>(`/projects/${projectId}/supplies`)); }
    catch {} finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { if (visible) { setLoading(true); load(); } }, [visible, load]);

  const toggle = async (item: Item) => {
    Haptics.selectionAsync();
    const next = !item.owned;
    setData((d) => d ? {
      ...d,
      materials: d.materials.map((i) => i.name === item.name ? { ...i, owned: next } : i),
      tools: d.tools.map((i) => i.name === item.name ? { ...i, owned: next } : i),
    } : d);
    try {
      await api(`/projects/${projectId}/supplies`, { method: "PATCH", body: { name: item.name, owned: next } });
      load();
    } catch {}
  };

  const open = (url: string) => { Haptics.selectionAsync(); Linking.openURL(url).catch(() => {}); };

  const renderSection = (label: string, items: Item[], icon: string) => {
    if (!items.length) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <MaterialCommunityIcons name={icon as any} size={18} color={INK} />
          <Text style={styles.sectionTitle}>{label}</Text>
          <Text style={styles.sectionCount}>{items.filter((i) => i.owned).length}/{items.length}</Text>
        </View>
        {items.map((it) => (
          <View key={it.name} style={styles.item}>
            <Pressable testID={`supply-toggle-${it.name}`} style={styles.checkRow} onPress={() => toggle(it)}>
              <View style={[styles.checkbox, it.owned && styles.checkboxOn]}>
                {it.owned && <MaterialCommunityIcons name="check" size={15} color="#fff" />}
              </View>
              <Text style={[styles.itemName, it.owned && styles.itemNameOwned]}>{it.name}</Text>
            </Pressable>
            {!it.owned && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.buyRow}>
                {it.links.slice(0, 4).map((l) => (
                  <Pressable key={l.retailer} testID={`supply-buy-${it.name}-${l.retailer}`} style={styles.buyBtn} onPress={() => open(l.url)}>
                    <Text style={styles.buyText}>{l.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          {loading || !data ? (
            <ActivityIndicator color={ORANGE} style={{ marginVertical: spacing["3xl"] }} />
          ) : (
            <>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Supply List</Text>
                  <Text style={styles.subtitle}>{data.owned_count} of {data.total} ready</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={10}><MaterialCommunityIcons name="close" size={26} color={SLATE} /></Pressable>
              </View>

              <View style={styles.readyWrap}>
                <View style={styles.readyBarBg}><View style={[styles.readyBarFill, { width: `${data.readiness}%` }]} /></View>
                <Text style={styles.readyText}>
                  {data.readiness === 100 ? "🎉 Ready to start — you've got everything!" : `Ready to start: ${data.readiness}%`}
                </Text>
              </View>

              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                {renderSection("MATERIALS", data.materials, "package-variant-closed")}
                {renderSection("TOOLS", data.tools, "toolbox-outline")}
                <View style={{ height: spacing.md }} />
              </ScrollView>

              {!!data.bundle_url && (
                <Pressable testID="supply-bundle" style={styles.orderBtn} onPress={() => open(data.bundle_url)}>
                  <MaterialCommunityIcons name="cart" size={20} color="#fff" />
                  <Text style={styles.orderText}>Order remaining on Amazon</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 3, borderTopColor: ORANGE, maxHeight: "88%" },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: "#DADADA", marginBottom: spacing.md },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  title: { color: INK, fontFamily: font.display, fontSize: 30 },
  subtitle: { color: SLATE, fontFamily: font.medium, fontSize: type.sm },
  readyWrap: { marginBottom: spacing.lg },
  readyBarBg: { height: 10, borderRadius: 5, backgroundColor: "#F0F0F0", overflow: "hidden" },
  readyBarFill: { height: 10, borderRadius: 5, backgroundColor: ORANGE },
  readyText: { color: INK, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm },
  section: { marginBottom: spacing.lg },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { color: INK, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1, flex: 1 },
  sectionCount: { color: SLATE, fontFamily: font.bold, fontSize: type.sm },
  item: { borderBottomColor: "#F0F0F0", borderBottomWidth: 1, paddingVertical: spacing.md },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 30 },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: "#CCCCCC", alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  itemName: { color: INK, fontFamily: font.bold, fontSize: type.lg, flex: 1 },
  itemNameOwned: { color: "#AAAAAA", textDecorationLine: "line-through" },
  buyRow: { gap: spacing.sm, paddingTop: spacing.sm, paddingLeft: 38 },
  buyBtn: { backgroundColor: "#F5F5F5", borderColor: "#E2E2E2", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  buyText: { color: INK, fontFamily: font.bold, fontSize: type.sm },
  orderBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: ORANGE, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm },
  orderText: { color: "#fff", fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.3 },
});
