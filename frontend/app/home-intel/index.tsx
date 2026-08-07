import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Asset = { id: string; name: string; category: string; status: string };
type Task = { id: string; user_description: string; status: string; risk_level: string; asset_name?: string; created_at: string };

const STATUS_COLOR: Record<string, string> = {
  active: colors.info, completed: colors.success, unresolved: colors.warning, escalated: colors.error,
};

export default function HomeIntelDashboard() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ asset_count: number; recent_assets: Asset[]; recent_tasks: Task[] }>("/hi/dashboard");
      setAssets(d.recent_assets); setTasks(d.recent_tasks); setCount(d.asset_count);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Intelligence" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.hero}>What do you need help with?</Text>

        <Pressable testID="hi-fix" style={styles.primary} onPress={() => router.push("/home-intel/help")}>
          <MaterialCommunityIcons name="wrench-outline" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Fix or maintain something</Text>
        </Pressable>
        <Pressable testID="hi-assets" style={styles.secondary} onPress={() => router.push("/home-intel/assets")}>
          <MaterialCommunityIcons name="home-search-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>My Home Assets{count ? ` (${count})` : ""}</Text>
        </Pressable>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            <Text style={styles.section}>Recent assets</Text>
            {assets.length === 0 ? (
              <Text style={styles.empty}>No assets yet. Add your appliances & systems so guidance can be tailored to them.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {assets.map((a) => (
                  <Pressable key={a.id} testID={`hi-asset-${a.id}`} style={styles.assetChip} onPress={() => router.push(`/home-intel/asset/${a.id}`)}>
                    <MaterialCommunityIcons name="cube-outline" size={20} color={colors.brandPrimary} />
                    <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                    <Text style={styles.assetCat} numberOfLines={1}>{a.category}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <Text style={styles.section}>Recent tasks</Text>
            {tasks.length === 0 ? (
              <Text style={styles.empty}>No tasks yet. Describe an issue to get safe next-step guidance.</Text>
            ) : tasks.map((t) => (
              <Pressable key={t.id} testID={`hi-task-${t.id}`} style={styles.taskRow}
                onPress={() => router.push(`/home-intel/guidance?issueId=${t.id}`)}>
                <View style={[styles.dot, { backgroundColor: STATUS_COLOR[t.status] || colors.info }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskText} numberOfLines={1}>{t.user_description}</Text>
                  <Text style={styles.taskMeta}>{t.asset_name ? `${t.asset_name} · ` : ""}{t.status}{t.risk_level === "emergency" ? " · ⚠ emergency" : ""}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { color: colors.onSurface, fontFamily: font.display, fontSize: type["3xl"], marginBottom: spacing.lg },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  assetChip: { width: 130, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  assetName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.xs },
  assetCat: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  taskText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  taskMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
