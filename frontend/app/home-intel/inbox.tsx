import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const PRIORITY_COLOR: Record<string, string> = { emergency: "#EB5757", high: "#F2994A", normal: colors.brandPrimary, low: "#888", marketing: "#2F80ED" };
const CAT_ICON: Record<string, string> = {
  safety: "shield-alert-outline", maintenance: "wrench-outline", project: "hammer-screwdriver",
  document: "file-document-outline", collaboration: "account-multiple-outline", billing: "credit-card-outline",
  rewards: "gift-outline", account: "account-cog-outline", product: "star-outline", marketing: "bullhorn-outline",
};
const FILTERS = ["all", "safety", "maintenance", "project", "rewards", "collaboration", "account"];

export default function Inbox() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cat: string) => {
    try {
      const q = cat === "all" ? "" : `?category=${cat}`;
      const d = await api(`/hi/notifications/inbox${q}`);
      setItems(d.items || []); setUnread(d.unread_count || 0);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const open = async (it: any) => {
    try {
      const res = await api(`/hi/notifications/inbox/${it.id}/open`, { method: "POST" });
      await load(filter);
      if (res.access && res.deep_link) router.push(res.deep_link);
    } catch {}
  };
  const archive = async (it: any) => { try { await api(`/hi/notifications/inbox/${it.id}/archive`, { method: "POST" }); await load(filter); } catch {} };
  const readAll = async () => { try { await api("/hi/notifications/inbox/read-all", { method: "POST" }); await load(filter); } catch {} };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Inbox" right={
        <Pressable testID="inbox-settings" onPress={() => router.push("/home-intel/notification-settings")}><MaterialCommunityIcons name="cog-outline" size={22} color={colors.onSurface} /></Pressable>
      } />
      <View style={styles.topRow}>
        <Text style={styles.unread}>{unread} unread</Text>
        {unread > 0 ? <Pressable testID="inbox-read-all" onPress={readAll}><Text style={styles.readAll}>Mark all read</Text></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.lg }}>
        {FILTERS.map((f) => (
          <Pressable key={f} testID={`inbox-filter-${f}`} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{f}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} /> :
          items.length === 0 ? <Text style={styles.empty}>You're all caught up.</Text> :
            items.map((it) => (
              <Pressable key={it.id} testID={`inbox-item-${it.id}`} style={[styles.item, !it.read_at && styles.itemUnread]} onPress={() => open(it)}>
                <View style={[styles.catIcon, { backgroundColor: (PRIORITY_COLOR[it.priority] || colors.brandPrimary) + "18" }]}>
                  <MaterialCommunityIcons name={(CAT_ICON[it.category] || "bell-outline") as any} size={20} color={PRIORITY_COLOR[it.priority] || colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.itemHead}>
                    {!it.read_at ? <View style={styles.dot} /> : null}
                    <Text style={styles.itemTitle} numberOfLines={1}>{it.title}</Text>
                  </View>
                  <Text style={styles.itemBody} numberOfLines={2}>{it.body}</Text>
                  <Text style={styles.itemMeta}>{it.category}{it.priority === "emergency" ? " · urgent" : ""}</Text>
                </View>
                <Pressable testID={`inbox-archive-${it.id}`} hitSlop={8} onPress={() => archive(it)}><MaterialCommunityIcons name="archive-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  unread: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  readAll: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  filterBar: { flexGrow: 0, marginTop: spacing.sm, marginBottom: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl },
  item: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemUnread: { borderColor: colors.brandPrimary + "55", backgroundColor: colors.brandPrimary + "08" },
  catIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  itemTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  itemBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 3, textTransform: "capitalize" },
});
