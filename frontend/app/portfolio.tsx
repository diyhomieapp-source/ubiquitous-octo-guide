import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { PortfolioReport, Portfolio } from "@/src/components/PortfolioReport";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function PortfolioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<(Portfolio & { share_token?: string; is_public?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api("/portfolio")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const link = d?.share_token ? `${BASE}/r/${d.share_token}` : "";

  const enableShare = async () => {
    Haptics.selectionAsync();
    const r = await api<{ share_token: string }>("/portfolio/share", { method: "POST", body: { public: true } });
    setD((x) => x ? { ...x, share_token: r.share_token, is_public: true } : x);
    return `${BASE}/r/${r.share_token}`;
  };

  const doShare = async () => {
    const url = link || await enableShare();
    try { await Share.share({ message: `My verified home improvement record — ${d?.totals.projects} projects, $${Math.round((d?.totals.saved_cents || 0) / 100)} saved:\n${url}` }); } catch {}
  };
  const copy = async () => {
    const url = link || await enableShare();
    await Clipboard.setStringAsync(url);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  if (loading || !d) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="portfolio-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Home Portfolio</Text>
        <Pressable testID="portfolio-share" hitSlop={10} onPress={doShare}><MaterialCommunityIcons name="share-variant-outline" size={22} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <View style={styles.shareBar}>
          <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.shareText}>Export or share this record for insurance, resale or refinancing.</Text>
        </View>
        <View style={styles.shareBtns}>
          <Pressable testID="portfolio-copy" style={styles.copyBtn} onPress={copy}>
            <MaterialCommunityIcons name={copied ? "check" : "link-variant"} size={16} color={colors.onSurface} />
            <Text style={styles.copyText}>{copied ? "Copied!" : "Copy link"}</Text>
          </Pressable>
          <Pressable testID="portfolio-share-btn" style={styles.sendBtn} onPress={doShare}>
            <MaterialCommunityIcons name="export-variant" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.sendText}>Share / Export</Text>
          </Pressable>
        </View>
        <Text style={styles.tip}>Open the shared link in a browser and use “Print → Save as PDF” for a printable packet.</Text>

        <View style={{ height: spacing.lg }} />
        <PortfolioReport d={d} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  shareBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandTertiary + "44", borderRadius: radius.md, padding: spacing.md },
  shareText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  shareBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  copyBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.borderStrong, borderWidth: 1.5 },
  copyText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  sendText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  tip: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, textAlign: "center" },
});
