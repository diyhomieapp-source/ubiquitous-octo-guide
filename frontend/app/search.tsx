import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ProReferralModal } from "@/src/components/ProReferralModal";

type Result = { type: string; title: string; snippet: string; route: string; category?: string; author?: string };
type SearchResp = { query: string; results: Result[]; related: string[]; did_you_mean: string | null; counts: Record<string, number> };

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  guide: { label: "Guide", icon: "book-open-variant", color: colors.brandPrimary },
  community: { label: "Community", icon: "account-group-outline", color: colors.info },
  tip: { label: "Tip", icon: "lightbulb-on-outline", color: colors.warning },
  question: { label: "Q&A", icon: "help-circle-outline", color: colors.onSurfaceSecondary },
};

const SUGGESTIONS = ["Leaky faucet", "Paint a room", "Replace outlet", "Deck repair", "Unclog drain", "Hang shelves"];

export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [proOpen, setProOpen] = useState(false);

  const run = async (term?: string) => {
    const query = (term ?? q).trim();
    if (query.length < 2) return;
    setQ(query);
    Keyboard.dismiss();
    setLoading(true);
    Haptics.selectionAsync();
    try { setData(await api<SearchResp>(`/knowledge/search?q=${encodeURIComponent(query)}`, { timeout: 30000 })); }
    catch {} finally { setLoading(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="search-back" hitSlop={10} onPress={() => router.back()}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="search-input"
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search guides, tips & fixes…"
            placeholderTextColor={colors.onSurfaceTertiary}
            returnKeyType="search"
            autoFocus
            onSubmitEditing={() => run()}
          />
          {q.length > 0 && (
            <Pressable testID="search-clear" hitSlop={8} onPress={() => { setQ(""); setData(null); }}>
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!data && !loading && (
          <>
            <Text style={styles.section}>POPULAR SEARCHES</Text>
            <View style={styles.sugWrap}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} testID={`search-suggest-${s}`} style={styles.sug} onPress={() => run(s)}>
                  <MaterialCommunityIcons name="trending-up" size={14} color={colors.brandPrimary} />
                  <Text style={styles.sugText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {loading && <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>}

        {data && !loading && (
          <>
            {data.did_you_mean && data.did_you_mean.toLowerCase() !== data.query.toLowerCase() && (
              <Pressable testID="search-dym" style={styles.dym} onPress={() => run(data.did_you_mean!)}>
                <Text style={styles.dymLabel}>Did you mean </Text>
                <Text style={styles.dymTerm}>{data.did_you_mean}</Text>
                <Text style={styles.dymLabel}>?</Text>
              </Pressable>
            )}

            <Text style={styles.resultCount}>{data.results.length} result{data.results.length === 1 ? "" : "s"} for "{data.query}"</Text>

            {data.results.map((r, i) => {
              const m = TYPE_META[r.type] || TYPE_META.guide;
              return (
                <Pressable key={i} testID={`search-result-${i}`} style={styles.card} onPress={() => router.push(r.route as any)}>
                  <View style={[styles.typeIcon, { backgroundColor: m.color + "22" }]}>
                    <MaterialCommunityIcons name={m.icon as any} size={20} color={m.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.typeLabel, { color: m.color }]}>{m.label}{r.author ? ` · ${r.author}` : ""}</Text>
                    <Text style={styles.cardTitle} numberOfLines={2}>{r.title}</Text>
                    {!!r.snippet && <Text style={styles.cardSnippet} numberOfLines={2}>{r.snippet}</Text>}
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
                </Pressable>
              );
            })}

            {data.related.length > 0 && (
              <>
                <Text style={styles.section}>RELATED SEARCHES</Text>
                <View style={styles.sugWrap}>
                  {data.related.map((s) => (
                    <Pressable key={s} testID={`search-related-${s}`} style={styles.sug} onPress={() => run(s)}>
                      <MaterialCommunityIcons name="magnify" size={13} color={colors.onSurfaceSecondary} />
                      <Text style={styles.sugText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* escalation: Ask for Guidance + Get a Pro */}
            <View style={styles.escalate}>
              <Text style={styles.escTitle}>{data.results.length === 0 ? "Nothing matched — get unstuck" : "Still stuck?"}</Text>
              <Pressable testID="search-ask-community" style={styles.escBtn} onPress={() => router.push("/(tabs)/community")}>
                <MaterialCommunityIcons name="account-group" size={20} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.escBtnTitle}>Ask the community</Text>
                  <Text style={styles.escBtnSub}>Get answers from homeowners who've done it.</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable testID="search-get-pro" style={styles.escBtn} onPress={() => setProOpen(true)}>
                <MaterialCommunityIcons name="account-hard-hat" size={20} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.escBtnTitle}>Get a local pro</Text>
                  <Text style={styles.escBtnSub}>For structural, electrical & above-DIY jobs.</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <ProReferralModal visible={proOpen} onClose={() => setProOpen(false)} presetIssue={data?.query} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  input: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  sugWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sug: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sugText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  dym: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  dymLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  dymTerm: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  resultCount: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.md },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  typeIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  typeLabel: { fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 1 },
  cardSnippet: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 17 },
  escalate: { marginTop: spacing.xl, backgroundColor: colors.brandTertiary + "44", borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  escTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.xs },
  escBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  escBtnTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  escBtnSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
});
