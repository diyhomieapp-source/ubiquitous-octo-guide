import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_LABEL: Record<string, string> = {
  community_contributor: "Community Contributor",
  verified_creator: "Verified Creator",
  verified_professional: "Verified Professional",
  licensed_professional: "Licensed Professional",
  diyhomie_expert: "DIYhomie Expert",
};

export default function CreatorProfile() {
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/proconnect/creators/${cid}`)); } catch {} finally { setLoading(false); }
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    try {
      const r = await api<any>(`/hi/proconnect/creators/${cid}/follow`, { method: "POST" });
      setData((d: any) => ({ ...d, following: r.following }));
    } catch {}
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Creator" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  if (!data?.creator) return <View style={styles.root}><ScreenHeader title="Creator" /><Text style={[styles.body, { padding: spacing.lg }]}>Creator not found.</Text></View>;

  const c = data.creator;
  const licensed = c.professional_status === "licensed_professional";

  return (
    <View style={styles.root}>
      <ScreenHeader title={c.channel_name} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.card}>
          <View style={styles.headRow}>
            <View style={styles.avatar}>
              <MaterialCommunityIcons name={licensed ? "certificate" : "account-star"} size={28} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.trade}>{c.trade} · {c.years_experience} yrs</Text>
              <View style={[styles.statusChip, licensed && { borderColor: colors.success + "88" }]}>
                <MaterialCommunityIcons name={licensed ? "shield-check" : "check-decagram-outline"} size={13} color={licensed ? colors.success : colors.brandPrimary} />
                <Text style={[styles.statusText, licensed && { color: colors.success }]}>{STATUS_LABEL[c.professional_status] || c.professional_status}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.bio}>{c.bio}</Text>
          <Text style={styles.meta}>{(c.follower_count || 0).toLocaleString()} followers · {(c.specialties || []).join(", ")}</Text>
          {c.affiliate_disclosure ? <Text style={styles.disclosure}>ⓘ {c.affiliate_disclosure}</Text> : null}
          <Pressable testID="creator-follow" style={[styles.followBtn, data.following && styles.followingBtn]} onPress={toggleFollow}>
            <MaterialCommunityIcons name={data.following ? "account-check" : "account-plus-outline"} size={18} color={data.following ? colors.success : colors.onBrandPrimary} />
            <Text style={[styles.followText, data.following && { color: colors.success }]}>{data.following ? "Following" : "Follow"}</Text>
          </Pressable>
        </View>

        {(data.featured_procedures || []).length > 0 && (
          <>
            <Text style={styles.section}>Featured in procedures</Text>
            {data.featured_procedures.map((p: any) => (
              <Pressable key={p.id} testID={`creator-proc-${p.id}`} style={styles.rowCard} onPress={() => router.push(`/home-intel/guide/${p.id}`)}>
                <MaterialCommunityIcons name="clipboard-list-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.rowText}>{p.title}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </>
        )}

        {(data.demos || []).length > 0 && (
          <>
            <Text style={styles.section}>Demonstrations</Text>
            {data.demos.map((d: any) => (
              <View key={d.id} style={styles.rowCard}>
                <MaterialCommunityIcons name="play-circle-outline" size={20} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowText}>{d.title}</Text>
                  <Text style={styles.rowMeta}>{Math.round(d.duration_sec / 6) / 10} min · {d.skill_level}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {(data.insights || []).length > 0 && (
          <>
            <Text style={styles.section}>Professional insights</Text>
            {data.insights.map((i: any) => (
              <View key={i.id} style={styles.insightCard}>
                <Text style={styles.insightQuote}>&ldquo;{i.quote}&rdquo;</Text>
                <Text style={styles.insightAttribution}>— {i.attribution}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { ...type.body, color: colors.onSurfaceSecondary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md },
  headRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary + "22", alignItems: "center", justifyContent: "center" },
  name: { ...type.heading, color: colors.onSurface },
  trade: { ...type.caption, color: colors.onSurfaceSecondary, marginTop: 2 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.brandPrimary + "66", borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.xs },
  statusText: { ...type.caption, fontSize: 11, color: colors.brandPrimary },
  bio: { ...type.body, color: colors.onSurfaceSecondary, marginTop: spacing.md },
  meta: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  disclosure: { ...type.caption, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: spacing.xs, fontStyle: "italic" },
  followBtn: { flexDirection: "row", gap: spacing.xs, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.md },
  followingBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.success + "88" },
  followText: { ...type.button, color: colors.onBrandPrimary },
  section: { ...type.button, fontSize: 15, color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  rowCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, minHeight: 56 },
  rowText: { ...type.body, color: colors.onSurface, flex: 1 },
  rowMeta: { ...type.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
  insightCard: { backgroundColor: colors.warning + "12", borderColor: colors.warning + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  insightQuote: { ...type.body, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  insightAttribution: { ...type.caption, color: colors.warning, marginTop: spacing.xs },
});
