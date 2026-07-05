import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Feature = { key: string; label: string; description: string; icon: string; can_optin: boolean; opted_in: boolean; enabled_for_me: boolean };

const EMOJIS = ["😞", "😕", "😐", "🙂", "🤩"];

export default function Beta() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api<{ features: Feature[] }>("/features"); setItems(d.features); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (f: Feature) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await api(`/features/${f.key}/optin`, { method: "POST", body: { optin: !f.opted_in } }); load(); } catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="beta-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Beta Features</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          <Text style={styles.intro}>Try experimental features early and tell us what you think — your feedback shapes what ships.</Text>
          {items.length === 0 ? (
            <View style={styles.empty}><MaterialCommunityIcons name="flask-empty-outline" size={34} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No beta features open right now. Check back soon!</Text></View>
          ) : items.map((f) => <FeatureCard key={f.key} feature={f} toggle={() => toggle(f)} />)}
        </ScrollView>
      )}
    </View>
  );
}

function FeatureCard({ feature, toggle }: { feature: Feature; toggle: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <MaterialCommunityIcons name={feature.icon as any} size={24} color={colors.brandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{feature.label}</Text>
          {feature.enabled_for_me && <Text style={styles.onTag}>ENABLED FOR YOU</Text>}
        </View>
        {feature.can_optin && (
          <Pressable testID={`beta-toggle-${feature.key}`} style={[styles.switch, feature.opted_in && styles.switchOn]} onPress={toggle}>
            <View style={[styles.knob, feature.opted_in && styles.knobOn]} />
          </Pressable>
        )}
      </View>
      <Text style={styles.desc}>{feature.description}</Text>
      {feature.opted_in && <FeedbackBox flagKey={feature.key} />}
    </View>
  );
}

function FeedbackBox({ flagKey }: { flagKey: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy || (!rating && !comment.trim())) return;
    setBusy(true);
    try {
      await api("/beta-feedback", { method: "POST", body: { flag_key: flagKey, rating, useful: rating >= 4, comment: comment.trim() } });
      setSent(true); setComment(""); setRating(0);
      setTimeout(() => setSent(false), 2500);
    } catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.fbBox}>
      <Text style={styles.fbLabel}>How's it working for you?</Text>
      <View style={styles.emojiRow}>
        {EMOJIS.map((e, i) => (
          <Pressable key={i} testID={`beta-rate-${flagKey}-${i + 1}`} onPress={() => setRating(i + 1)} style={[styles.emojiBtn, rating === i + 1 && styles.emojiOn]}>
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput testID={`beta-comment-${flagKey}`} style={styles.fbInput} value={comment} onChangeText={setComment} placeholder="One line — what worked or what didn't?" placeholderTextColor={colors.onSurfaceTertiary} />
      <Pressable testID={`beta-send-${flagKey}`} style={styles.fbSend} onPress={send} disabled={busy}>
        <Text style={styles.fbSendText}>{sent ? "Thanks! ✓" : "Send feedback"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.md },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  onTag: { color: colors.success, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5, marginTop: 1 },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.brandPrimary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  fbBox: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  fbLabel: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  emojiRow: { flexDirection: "row", gap: spacing.xs },
  emojiBtn: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1 },
  emojiOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "18" },
  emoji: { fontSize: 20 },
  fbInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  fbSend: { alignSelf: "flex-start", backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  fbSendText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
