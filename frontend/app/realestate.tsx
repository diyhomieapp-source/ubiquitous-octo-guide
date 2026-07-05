import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Share, Platform, Image } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;
const origin = () => (typeof window !== "undefined" && window.location ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));

type Improvement = { title: string; room: string; skill_tag: string; cost_cents: number; created_at: string; label: string; confidence: string; after_photo?: string };
type Report = {
  owner: string; location: string;
  totals: { projects: number; invested_cents: number; saved_cents: number; hours: number; systems: number; rooms: number };
  improvements: Improvement[]; diy_count: number; pro_count: number;
  ai_summary: string; value_add: { estimate_cents: number; roi_pct: number; disclaimer: string };
  disclosure_checklist: { key: string; requirement: string }[];
  share_token: string | null; is_public: boolean;
};

const CONF_COLOR: Record<string, string> = { documented: colors.success, partial: colors.warning, "self-reported": colors.onSurfaceTertiary };

export default function RealEstate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    try { setR(await api<Report>("/realestate/report")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shareReport = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      let token = r?.share_token;
      if (!token || !r?.is_public) {
        const res = await api<{ share_token: string }>("/realestate/share", { method: "POST", body: { public: true } });
        token = res.share_token;
      }
      const link = `${origin()}/r/${token}`;
      await Share.share({ message: `${r?.owner}'s DIYhomie home improvement report — ${r?.totals.projects} verified projects.\n${link}` });
      load();
    } catch {} finally { setSharing(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="re-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Listing Report</Text>
        <Pressable testID="re-share" hitSlop={10} onPress={shareReport}>{sharing ? <ActivityIndicator size="small" color={colors.onSurface} /> : <MaterialCommunityIcons name="share-variant-outline" size={22} color={colors.onSurface} />}</Pressable>
      </View>

      {loading || !r ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>

          <Text style={styles.owner}>{r.owner}{r.location ? ` · ${r.location}` : ""}</Text>
          <Text style={styles.subtitle}>Transaction-ready home improvement record</Text>

          <View style={styles.valueCard}>
            <Text style={styles.valueLabel}>ESTIMATED VALUE ADDED</Text>
            <Text style={styles.valueBig}>{money(r.value_add.estimate_cents)}</Text>
            <Text style={styles.valueRoi}>{r.value_add.roi_pct >= 0 ? "+" : ""}{r.value_add.roi_pct}% vs materials invested ({money(r.totals.invested_cents)})</Text>
            <Text style={styles.disclaimer}>{r.value_add.disclaimer}</Text>
          </View>

          <View style={styles.aiCard}>
            <View style={styles.aiHead}><MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.brandPrimary} /><Text style={styles.aiTitle}>What's been improved?</Text></View>
            <Text style={styles.aiText}>{r.ai_summary}</Text>
          </View>

          <View style={styles.statRow}>
            <Stat value={String(r.totals.projects)} label="Improvements" />
            <Stat value={String(r.diy_count)} label="DIY" />
            <Stat value={String(r.pro_count)} label="Pro" />
            <Stat value={`${r.totals.hours}`} label="Hours" />
          </View>

          {r.disclosure_checklist.length > 0 && (
            <>
              <Text style={styles.section}>Disclosure checklist</Text>
              {r.disclosure_checklist.map((d) => (
                <View key={d.key} style={styles.discRow}>
                  <MaterialCommunityIcons name="clipboard-alert-outline" size={16} color={colors.warning} />
                  <Text style={styles.discText}>{d.requirement}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={styles.section}>Improvements ({r.improvements.length})</Text>
          {r.improvements.map((im, i) => (
            <View key={i} style={styles.impCard}>
              {im.after_photo ? <Image source={{ uri: im.after_photo }} style={styles.impPhoto} /> : null}
              <View style={{ flex: 1 }}>
                <View style={styles.impTop}>
                  <Text style={styles.impTitle} numberOfLines={1}>{im.title}</Text>
                  <View style={[styles.labelTag, { backgroundColor: (im.label === "Pro" ? colors.info : colors.brandPrimary) + "22" }]}>
                    <Text style={[styles.labelText, { color: im.label === "Pro" ? colors.info : colors.brandPrimary }]}>{im.label}</Text>
                  </View>
                </View>
                <Text style={styles.impMeta}>{(im.created_at || "").slice(0, 10)}{im.room ? ` · ${im.room}` : ""}{im.cost_cents ? ` · ${money(im.cost_cents)}` : ""}</Text>
                <View style={styles.confRow}>
                  <MaterialCommunityIcons name="shield-check-outline" size={12} color={CONF_COLOR[im.confidence]} />
                  <Text style={[styles.confText, { color: CONF_COLOR[im.confidence] }]}>{im.confidence}</Text>
                </View>
              </View>
            </View>
          ))}

          <Pressable testID="re-share-btn" style={styles.shareBtn} onPress={shareReport}>
            <MaterialCommunityIcons name="link-variant" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.shareText}>{r.is_public ? "Share report with agent / buyer" : "Generate shareable report link"}</Text>
          </Pressable>
          {r.is_public && r.share_token ? <Text style={styles.linkNote}>Public link: {origin()}/r/{r.share_token}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  owner: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  valueCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  valueLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  valueBig: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 38, marginTop: 2 },
  valueRoi: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, fontStyle: "italic", marginTop: spacing.sm },
  aiCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  aiHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xs },
  aiTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  aiText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  discRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  discText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  impCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
  impPhoto: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: colors.surface },
  impTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  impTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  labelTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  labelText: { fontFamily: font.bold, fontSize: 10 },
  impMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  confRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  confText: { fontFamily: font.medium, fontSize: 11, textTransform: "capitalize" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  shareText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  linkNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, textAlign: "center" },
});
