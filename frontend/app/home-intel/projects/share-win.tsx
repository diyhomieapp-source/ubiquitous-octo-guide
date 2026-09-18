import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Share } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { HomieFace } from "@/src/components/HomieFace";

export default function ShareWin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shotRef = useRef<ViewShot>(null);
  const [project, setProject] = useState<any>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api(`/hi/projects/${id}`);
      setProject(p.project || p);
      try {
        const c = await api(`/hi/celebration/projects/${id}/completion`);
        setCompletion(c.completion);
      } catch {}
      try {
        const o = await api(`/hi/projects/${id}/outcome`);
        if (o.outcome?.completion_photo_base64) setPhoto(o.outcome.completion_photo_base64);
      } catch {}
      try {
        const a = await api("/hi/celebration/achievements");
        setAchievements((a.achievements || []).filter((x: any) => x.project_id === id));
      } catch {}
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shareText = () => {
    const title = project?.title || "my home project";
    let t = `I just finished ${title} myself with DIYhomie! 🛠️`;
    if (completion?.estimated_savings > 0) t += ` Estimated savings: $${completion.estimated_savings}.`;
    return t;
  };

  const shareCard = async () => {
    setSharing(true);
    try {
      if (Platform.OS === "web") {
        // web fallback: native share sheet with text, else clipboard
        const nav: any = typeof navigator !== "undefined" ? navigator : null;
        if (nav?.share) {
          await nav.share({ title: "My DIY win", text: shareText() });
        } else if (nav?.clipboard) {
          await nav.clipboard.writeText(shareText());
          Alert.alert("Copied!", "Your win is copied — paste it anywhere.");
        }
      } else {
        const uri = await shotRef.current?.capture?.();
        if (uri && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share my win" });
        } else {
          await Share.share({ message: shareText() });
        }
      }
    } catch (e: any) {
      if (!String(e?.message || "").toLowerCase().includes("cancel")) {
        Alert.alert("Couldn't share", "Try again or take a screenshot of the card.");
      }
    } finally { setSharing(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Share My Win" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const completedAt = completion?.completed_at || project?.updated_at;
  const month = completedAt ? new Date(completedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Share My Win" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], alignItems: "center" }}>
        <ViewShot ref={shotRef} options={{ format: "png", quality: 0.95 }} style={styles.card}>
          <View style={styles.cardHead}>
            <HomieFace size={54} pose="celebrating" />
            <View style={{ flex: 1 }}>
              <Text style={styles.done}>PROJECT COMPLETE</Text>
              <Text style={styles.title} numberOfLines={2}>{project?.title || "My project"}</Text>
              {!!month && <Text style={styles.date}>{month}</Text>}
            </View>
          </View>

          {!!photo && (
            <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" />
          )}

          <View style={styles.statsRow}>
            {completion?.actual_cost != null && (
              <View style={styles.stat}><Text style={styles.statVal}>${completion.actual_cost}</Text><Text style={styles.statLabel}>I spent</Text></View>
            )}
            {completion?.estimated_savings != null && completion.estimated_savings > 0 && (
              <View style={styles.stat}><Text style={[styles.statVal, { color: colors.success }]}>~${completion.estimated_savings}</Text><Text style={styles.statLabel}>est. saved*</Text></View>
            )}
            <View style={styles.stat}><Text style={styles.statVal}>💪</Text><Text style={styles.statLabel}>did it myself</Text></View>
          </View>

          {achievements.length > 0 && (
            <View style={styles.achRow}>
              {achievements.slice(0, 3).map((a) => (
                <View key={a.id} style={styles.achChip}>
                  <MaterialCommunityIcons name="trophy-outline" size={12} color={colors.warning} />
                  <Text style={styles.achText}>{a.label}</Text>
                </View>
              ))}
            </View>
          )}

          {completion?.estimated_savings != null && completion.estimated_savings > 0 && (
            <Text style={styles.disclaimer}>*Savings estimated vs. typical pro pricing — not guaranteed.</Text>
          )}

          <View style={styles.brandRow}>
            <View style={styles.brandTile}><MaterialCommunityIcons name="home-variant" size={13} color={colors.onBrandPrimary} /></View>
            <Text style={styles.brand}>Built with DIY<Text style={{ color: colors.brandPrimary }}>homie</Text></Text>
          </View>
        </ViewShot>

        <Pressable testID="share-win-btn" style={styles.shareBtn} disabled={sharing} onPress={shareCard}>
          {sharing ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <MaterialCommunityIcons name="share-variant" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.shareText}>Share My Win</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>{Platform.OS === "web" ? "On web this shares your win as text — the photo card shares from the mobile app." : "Shares the card above as an image."}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { width: "100%", maxWidth: 420, backgroundColor: "#151515", borderColor: colors.brandPrimary + "55", borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  done: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11, letterSpacing: 2 },
  title: { color: "#FFFFFF", fontFamily: font.display, fontSize: type["2xl"], lineHeight: 30 },
  date: { color: "#FFFFFF88", fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  photo: { width: "100%", height: 180, borderRadius: radius.md },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: "#FFFFFF0D", borderRadius: radius.md, paddingVertical: spacing.md },
  statVal: { color: "#FFFFFF", fontFamily: font.bold, fontSize: type.lg },
  statLabel: { color: "#FFFFFF88", fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  achRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  achChip: { flexDirection: "row", alignItems: "center", gap: 4, borderColor: colors.warning, borderWidth: 1, backgroundColor: colors.warning + "18", borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: spacing.sm },
  achText: { color: colors.warning, fontFamily: font.bold, fontSize: 11 },
  disclaimer: { color: "#FFFFFF55", fontFamily: font.regular, fontSize: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, justifyContent: "center", marginTop: spacing.xs },
  brandTile: { width: 20, height: 20, borderRadius: 5, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  brand: { color: "#FFFFFF", fontFamily: font.bold, fontSize: type.sm },
  shareBtn: { flexDirection: "row", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing["2xl"], alignItems: "center", justifyContent: "center", marginTop: spacing.lg, minWidth: 220 },
  shareText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm, textAlign: "center" },
});
