import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Breakdown = { label: string; value_cents: number; note: string };
type Roi = {
  project_id: string; timeline_id: string; title: string; room_label: string; skill_tag: string; skill_icon: string;
  spend_cents: number; pro_cost_cents: number; saved_cents: number; value_add_cents: number; roi_pct: number;
  hours: number; hourly_cents: number; life_years: number; created_at: string; breakdown: Breakdown[]; sharecard: string; badges?: string[];
};
type Rec = { id: string; title: string; icon: string; annual_savings_cents: number; est_cost_cents: number; payback_years: number | null; note: string };

const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const BADGE_ICON: Record<string, string> = { "Best ROI": "trophy-outline", "Most Efficient": "lightning-bolt-outline", "Verified Value": "check-decagram-outline" };

export default function ROI() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [totals, setTotals] = useState<any | null>(null);
  const [projects, setProjects] = useState<Roi[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [season, setSeason] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api<{ totals: any; projects: Roi[] }>("/roi/summary"),
        api<{ season: string; recommendations: Rec[] }>("/roi/recommendations"),
      ]);
      setTotals(s.totals); setProjects(s.projects); setRecs(r.recommendations); setSeason(r.season);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async (r: Roi) => { try { await Share.share({ message: r.sharecard }); } catch {} };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="roi-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Your Impact</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>TOTAL MONEY SAVED VS PROS</Text>
            <Text style={styles.heroValue}>{usd(totals?.saved_cents || 0)}</Text>
            <View style={styles.heroGrid}>
              <HeroStat label="Value added" value={usd(totals?.value_add_cents || 0)} />
              <HeroStat label="Avg ROI" value={`${totals?.avg_roi_pct || 0}%`} />
              <HeroStat label="Hours DIY'd" value={`${totals?.hours || 0}`} />
              <HeroStat label="Per DIY hour" value={usd(totals?.hourly_cents || 0)} />
            </View>
          </View>

          {projects.length === 0 ? (
            <Text style={styles.empty}>Finish a project to unlock your verified savings, resale value add and next-best-ROI tips.</Text>
          ) : (
            <>
              <Text style={styles.section}>Project value cards</Text>
              {projects.map((r) => (
                <View key={r.timeline_id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.iconWrap}><MaterialCommunityIcons name={(r.skill_icon || "home-outline") as any} size={22} color={colors.brandPrimary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kitName}>{r.title}</Text>
                      <Text style={styles.meta}>{r.room_label} · {r.skill_tag}</Text>
                    </View>
                    <Pressable testID={`roi-share-${r.timeline_id}`} hitSlop={8} onPress={() => share(r)}><MaterialCommunityIcons name="share-variant-outline" size={20} color={colors.onSurfaceSecondary} /></Pressable>
                  </View>

                  <View style={styles.savedRow}>
                    <View style={styles.savedBox}><Text style={styles.savedLabel}>Saved</Text><Text style={styles.savedVal}>{usd(r.saved_cents)}</Text></View>
                    <View style={styles.savedBox}><Text style={styles.savedLabel}>Value added</Text><Text style={[styles.savedVal, { color: colors.onSurface }]}>{usd(r.value_add_cents)}</Text></View>
                    <View style={styles.savedBox}><Text style={styles.savedLabel}>ROI</Text><Text style={[styles.savedVal, { color: colors.onSurface }]}>{r.roi_pct}%</Text></View>
                  </View>

                  {!!(r.badges && r.badges.length) && (
                    <View style={styles.badgeRow}>
                      {r.badges.map((b) => (
                        <View key={b} style={styles.badge}><MaterialCommunityIcons name={(BADGE_ICON[b] || "star-outline") as any} size={12} color={colors.brandPrimary} /><Text style={styles.badgeText}>{b}</Text></View>
                      ))}
                    </View>
                  )}

                  <Pressable testID={`roi-expand-${r.timeline_id}`} style={styles.explainToggle} onPress={() => setOpen(open === r.timeline_id ? null : r.timeline_id)}>
                    <Text style={styles.explainText}>{open === r.timeline_id ? "Hide" : "How is this calculated?"}</Text>
                    <MaterialCommunityIcons name={open === r.timeline_id ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
                  </Pressable>
                  {open === r.timeline_id && (
                    <View style={styles.breakdown}>
                      {r.breakdown.map((b, i) => (
                        <View key={i} style={styles.bLine}>
                          <View style={styles.bTop}><Text style={styles.bLabel}>{b.label}</Text><Text style={styles.bValue}>{usd(b.value_cents)}</Text></View>
                          <Text style={styles.bNote}>{b.note}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </>
          )}

          <Text style={styles.section}>Next-highest-ROI picks {season ? `· ${season}` : ""}</Text>
          {recs.map((rc) => (
            <View key={rc.id} style={styles.recCard}>
              <View style={styles.iconWrap}><MaterialCommunityIcons name={(rc.icon || "lightbulb-on-outline") as any} size={20} color={colors.success} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.kitName}>{rc.title}</Text>
                <Text style={styles.recNote}>{rc.note}</Text>
                <View style={styles.recMeta}>
                  {rc.annual_savings_cents > 0 && <Text style={styles.recTag}>Saves {usd(rc.annual_savings_cents)}/yr</Text>}
                  {rc.payback_years != null && <Text style={styles.recTag}>Payback {rc.payback_years}y</Text>}
                  <Text style={styles.recTag}>~{usd(rc.est_cost_cents)} to do</Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return <View style={styles.heroStat}><Text style={styles.heroStatVal}>{value}</Text><Text style={styles.heroStatLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  hero: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  heroLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  heroValue: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 40, marginTop: 2 },
  heroGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm },
  heroStat: { flex: 1, minWidth: 70, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, padding: spacing.sm },
  heroStatVal: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  heroStatLabel: { color: colors.onBrandPrimary, opacity: 0.85, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginVertical: spacing.xl, lineHeight: 20 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary + "18", alignItems: "center", justifyContent: "center" },
  kitName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  savedRow: { flexDirection: "row", gap: spacing.sm },
  savedBox: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm },
  savedLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10 },
  savedVal: { color: colors.success, fontFamily: font.display, fontSize: 18, marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary + "18", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10 },
  explainToggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  explainText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  breakdown: { gap: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  bLine: { gap: 2 },
  bTop: { flexDirection: "row", justifyContent: "space-between" },
  bLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  bValue: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  bNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15 },
  recCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  recNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2 },
  recMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  recTag: { color: colors.success, fontFamily: font.bold, fontSize: 10, backgroundColor: colors.success + "18", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
});
