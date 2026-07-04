import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ProReferralModal } from "@/src/components/ProReferralModal";

type Pro = {
  id: string; name: string; trades: string[]; specialties: string[];
  location: string; rating: number; reviews_count: number; verified: boolean; bio: string;
};

export default function Pros() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ trade?: string; projectId?: string }>();
  const [pros, setPros] = useState<Pro[]>([]);
  const [trades, setTrades] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState<string | null>(params.trade || null);
  const [selected, setSelected] = useState<Pro | null>(null);

  const load = useCallback(async (t?: string | null, query?: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (t) qs.set("trade", t);
      if (query) qs.set("q", query);
      const r = await api<{ pros: Pro[]; trades: string[] }>(`/pros?${qs.toString()}`);
      setPros(r.pros); setTrades(r.trades);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(trade, q); }, [trade]));

  const pickTrade = (t: string) => {
    Haptics.selectionAsync();
    const next = trade === t ? null : t;
    setTrade(next); load(next, q);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="pros-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Find a Pro</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="pros-search" style={styles.input} value={q} onChangeText={setQ}
            placeholder="Search by name or specialty…" placeholderTextColor={colors.onSurfaceTertiary}
            returnKeyType="search" onSubmitEditing={() => load(trade, q)}
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tradeScroll} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
        {trades.map((t) => (
          <Pressable key={t} testID={`pros-trade-${t}`} style={[styles.tChip, trade === t && styles.tChipActive]} onPress={() => pickTrade(t)}>
            <Text style={[styles.tChipText, trade === t && styles.tChipTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"], gap: spacing.md }} showsVerticalScrollIndicator={false}>
          {pros.length === 0 && <Text style={styles.empty}>No pros match yet — try a different trade, or request a quote and we'll source one.</Text>}
          {pros.map((p) => (
            <View key={p.id} style={styles.card} testID={`pro-card-${p.id}`}>
              <View style={styles.cardTop}>
                <View style={styles.logo}><Text style={styles.logoText}>{p.name.charAt(0)}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                    {p.verified && <MaterialCommunityIcons name="check-decagram" size={16} color={colors.info} />}
                  </View>
                  <View style={styles.metaRow}>
                    <MaterialCommunityIcons name="star" size={13} color={colors.warning} />
                    <Text style={styles.meta}>{p.rating.toFixed(1)} ({p.reviews_count}) · {p.location}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.bio} numberOfLines={2}>{p.bio}</Text>
              <View style={styles.chips}>
                {p.specialties.slice(0, 3).map((s) => <View key={s} style={styles.spec}><Text style={styles.specText}>{s}</Text></View>)}
              </View>
              <Pressable testID={`pro-quote-${p.id}`} style={styles.quoteBtn} onPress={() => { Haptics.selectionAsync(); setSelected(p); }}>
                <MaterialCommunityIcons name="email-fast-outline" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.quoteText}>REQUEST A QUOTE</Text>
              </Pressable>
            </View>
          ))}

          <Pressable testID="pros-apply" style={styles.applyBtn} onPress={() => router.push("/pros-apply")}>
            <MaterialCommunityIcons name="briefcase-plus-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.applyText}>Are you a pro? List your business</Text>
          </Pressable>
        </ScrollView>
      )}

      <ProReferralModal
        visible={!!selected}
        onClose={() => setSelected(null)}
        proId={selected?.id}
        proName={selected?.name}
        presetTrade={selected?.trades?.[0]}
        projectId={params.projectId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  input: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  tradeScroll: { maxHeight: 44, marginBottom: spacing.xs },
  tChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, height: 36, justifyContent: "center" },
  tChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tChipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tChipTextActive: { color: colors.onBrandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, textAlign: "center", marginTop: spacing.xl },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logo: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  logoText: { color: colors.onBrandTertiary, fontFamily: font.display, fontSize: 22 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  bio: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  spec: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  specText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  quoteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.xs },
  quoteText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, marginTop: spacing.sm },
  applyText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
});
