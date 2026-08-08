import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { UpgradeNudge } from "@/src/components/UpgradeNudge";

type Asset = { id: string; name: string; category: string; status: string };
type Task = { id: string; user_description: string; status: string; risk_level: string; asset_name?: string; created_at: string };
type Home = { id: string; name?: string | null; is_active?: boolean };

const STATUS_COLOR: Record<string, string> = {
  active: colors.info, completed: colors.success, unresolved: colors.warning, escalated: colors.error,
};

export default function HomeIntelDashboard() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [homes, setHomes] = useState<Home[]>([]);
  const [onboarding, setOnboarding] = useState<{ complete: boolean; progress: number } | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ asset_count: number; recent_assets: Asset[]; recent_tasks: Task[] }>("/hi/dashboard");
      setAssets(d.recent_assets); setTasks(d.recent_tasks); setCount(d.asset_count);
    } catch {} finally { setLoading(false); }
    try {
      const o = await api<{ properties: Home[]; onboarding: { complete: boolean; progress: number } }>("/hi/account/overview");
      setHomes(o.properties); setOnboarding(o.onboarding);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const activeHome = homes.find((h) => h.is_active);
  const switchHome = async (id: string) => {
    setSwitcherOpen(false);
    if (id === activeHome?.id) return;
    try { await api(`/hi/account/properties/${id}/activate`, { method: "POST" }); setLoading(true); load(); } catch {}
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Intelligence" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>

        {homes.length > 0 && (
          <View style={styles.switcherWrap}>
            <Pressable testID="hi-home-switcher" style={styles.switcher} onPress={() => homes.length > 1 ? setSwitcherOpen((v) => !v) : router.push("/home-intel/account")}>
              <MaterialCommunityIcons name="home-city-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.switcherText} numberOfLines={1}>{activeHome?.name || "My Home"}</Text>
              <MaterialCommunityIcons name={switcherOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
            {switcherOpen && (
              <View style={styles.switcherMenu}>
                {homes.map((h) => (
                  <Pressable key={h.id} testID={`hi-home-opt-${h.id}`} style={styles.switcherOpt} onPress={() => switchHome(h.id)}>
                    <Text style={[styles.switcherOptText, h.is_active && { color: colors.brandPrimary, fontFamily: font.bold }]} numberOfLines={1}>{h.name || "Unnamed home"}</Text>
                    {h.is_active && <MaterialCommunityIcons name="check" size={16} color={colors.brandPrimary} />}
                  </Pressable>
                ))}
                <Pressable style={styles.switcherOpt} onPress={() => { setSwitcherOpen(false); router.push("/home-intel/account"); }}>
                  <Text style={[styles.switcherOptText, { color: colors.brandPrimary }]}>Manage homes…</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {onboarding && !onboarding.complete && (
          <Pressable testID="hi-onboarding-banner" style={styles.banner} onPress={() => router.push("/home-intel/welcome")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Finish setting up ({onboarding.progress}%)</Text>
              <View style={styles.bannerTrack}><View style={[styles.bannerFill, { width: `${onboarding.progress}%` }]} /></View>
              <Text style={styles.bannerSub}>A few quick steps so Homie fits your home.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.brandPrimary} />
          </Pressable>
        )}

        <UpgradeNudge />

        <Text style={styles.hero}>What do you need help with?</Text>

        <Pressable testID="hi-fix" style={styles.primary} onPress={() => router.push("/home-intel/help")}>
          <MaterialCommunityIcons name="wrench-outline" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Fix or maintain something</Text>
        </Pressable>
        <Pressable testID="hi-chat" style={styles.secondary} onPress={() => router.push("/home-intel/chat")}>
          <MaterialCommunityIcons name="robot-happy-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Ask Homie</Text>
        </Pressable>
        <Pressable testID="hi-assets" style={styles.secondary} onPress={() => router.push("/home-intel/assets")}>
          <MaterialCommunityIcons name="home-search-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>My Home Assets{count ? ` (${count})` : ""}</Text>
        </Pressable>
        <Pressable testID="hi-map-home" style={styles.secondary} onPress={() => router.push("/home-intel/rooms")}>
          <MaterialCommunityIcons name="floor-plan" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Map my home</Text>
        </Pressable>
        <Pressable testID="hi-projects" style={styles.secondary} onPress={() => router.push("/home-intel/projects")}>
          <MaterialCommunityIcons name="hammer-wrench" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Plan a Project</Text>
        </Pressable>
        <Pressable testID="hi-maintenance" style={styles.secondary} onPress={() => router.push("/home-intel/maintenance")}>
          <MaterialCommunityIcons name="calendar-check-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Home Care &amp; Maintenance</Text>
        </Pressable>
        <Pressable testID="hi-account" style={styles.secondary} onPress={() => router.push("/home-intel/account")}>
          <MaterialCommunityIcons name="tune-vertical" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Setup &amp; Preferences</Text>
        </Pressable>
        <Pressable testID="hi-inventory" style={styles.secondary} onPress={() => router.push("/home-intel/inventory")}>
          <MaterialCommunityIcons name="toolbox-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>My Toolbox</Text>
        </Pressable>
        <Pressable testID="hi-vault" style={styles.secondary} onPress={() => router.push("/home-intel/documents")}>
          <MaterialCommunityIcons name="folder-lock-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Document Vault</Text>
        </Pressable>
        <Pressable testID="hi-jobs" style={styles.secondary} onPress={() => router.push("/home-intel/jobs")}>
          <MaterialCommunityIcons name="account-hard-hat-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Contact a Pro</Text>
        </Pressable>
        <Pressable testID="hi-rewards" style={styles.secondary} onPress={() => router.push("/home-intel/rewards")}>
          <MaterialCommunityIcons name="trophy-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>DIYhomie Points</Text>
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
  switcherWrap: { marginBottom: spacing.md, zIndex: 10 },
  switcher: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  switcherText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  switcherMenu: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, marginTop: spacing.xs, overflow: "hidden" },
  switcherOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  switcherOptText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, flex: 1 },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  bannerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  bannerTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface, marginVertical: 6, overflow: "hidden" },
  bannerFill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  bannerSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
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
