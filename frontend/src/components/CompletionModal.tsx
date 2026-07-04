import { useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import ConfettiCannon from "react-native-confetti-cannon";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Achievement = { id: string; title: string; icon: string; desc: string };
type Result = {
  entry: any;
  money_saved_cents: number;
  pro_cost_cents: number;
  new_achievements: Achievement[];
};

const money = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;

export function CompletionModal({
  visible, projectId, projectTitle, onClose, onDone,
}: {
  visible: boolean; projectId: string; projectTitle: string;
  onClose: () => void; onDone: () => void;
}) {
  const [cost, setCost] = useState("");
  const [hours, setHours] = useState("");
  const [rating, setRating] = useState(0);
  const [reflection, setReflection] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const pick = async (which: "before" | "after") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert("Photos", "Enable photo access in Settings to add a photo.", [
          { text: "OK" },
        ]);
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5, base64: true, allowsEditing: true, aspect: [4, 3],
    });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const b64 = res.assets[0].base64;
      which === "before" ? setBefore(b64) : setAfter(b64);
    }
  };

  const submit = async () => {
    setBusy(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const body = {
        cost_cents: cost ? Math.round(parseFloat(cost) * 100) : null,
        hours: hours ? parseFloat(hours) : null,
        rating: rating || null,
        reflection: reflection.trim(),
        before_photo: before,
        after_photo: after,
        share_community: share,
      };
      const r = await api<Result>(`/projects/${projectId}/complete`, { method: "POST", body, timeout: 120000 });
      setResult(r);
    } catch (e: any) {
      Alert.alert("Homie", e?.message || "Couldn't log this project. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    // reset for potential reuse
    setResult(null); setCost(""); setHours(""); setRating(0); setReflection("");
    setBefore(null); setAfter(null); setShare(true);
    onDone();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          {!result ? (
            <>
              <View style={styles.grip} />
              <View style={styles.head}>
                <View style={styles.trophy}><MaterialCommunityIcons name="trophy-outline" size={22} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Finish this project</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{projectTitle}</Text>
                </View>
                <Pressable testID="completion-close" hitSlop={10} onPress={onClose}>
                  <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceTertiary} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.hint}>Log a few details so Homie can celebrate your win and tally your savings.</Text>

                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>MATERIAL COST</Text>
                    <View style={styles.inputRow}>
                      <Text style={styles.dollar}>$</Text>
                      <TextInput testID="completion-cost" style={styles.numInput} value={cost} onChangeText={setCost} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>HOURS SPENT</Text>
                    <TextInput testID="completion-hours" style={[styles.numInput, styles.soloInput]} value={hours} onChangeText={setHours} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                </View>

                <Text style={styles.label}>HOW DID IT GO?</Text>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} testID={`completion-star-${n}`} hitSlop={6} onPress={() => { Haptics.selectionAsync(); setRating(n); }}>
                      <MaterialCommunityIcons name={n <= rating ? "star" : "star-outline"} size={34} color={n <= rating ? colors.warning : colors.onSurfaceTertiary} />
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>YOUR TAKE (OPTIONAL)</Text>
                <TextInput testID="completion-reflection" style={styles.textArea} value={reflection} onChangeText={setReflection} placeholder="What went well? Any tips for the next DIYer?" placeholderTextColor={colors.onSurfaceTertiary} multiline />

                <Text style={styles.label}>BEFORE / AFTER (OPTIONAL)</Text>
                <View style={styles.photoRow}>
                  {(["before", "after"] as const).map((w) => {
                    const img = w === "before" ? before : after;
                    return (
                      <Pressable key={w} testID={`completion-photo-${w}`} style={styles.photoBox} onPress={() => pick(w)}>
                        {img ? (
                          <Image source={{ uri: `data:image/jpeg;base64,${img}` }} style={styles.photo} contentFit="cover" />
                        ) : (
                          <>
                            <MaterialCommunityIcons name="camera-plus-outline" size={26} color={colors.onSurfaceTertiary} />
                            <Text style={styles.photoLabel}>{w === "before" ? "Before" : "After"}</Text>
                          </>
                        )}
                      </Pressable>
                    );
                  })}
                </View>

                <Pressable testID="completion-share-toggle" style={styles.shareRow} onPress={() => setShare((s) => !s)}>
                  <MaterialCommunityIcons name={share ? "checkbox-marked" : "checkbox-blank-outline"} size={24} color={share ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shareTitle}>Share to the community feed</Text>
                    <Text style={styles.shareSub}>Inspire other homeowners with your win.</Text>
                  </View>
                </Pressable>

                <Pressable testID="completion-submit" style={styles.cta} onPress={submit} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <MaterialCommunityIcons name="party-popper" size={20} color={colors.onBrandPrimary} />
                      <Text style={styles.ctaText}>COMPLETE PROJECT</Text>
                    </>
                  )}
                </Pressable>
              </ScrollView>
            </>
          ) : (
            <View style={styles.resultWrap}>
              <ConfettiCannon count={120} origin={{ x: 180, y: -20 }} fadeOut autoStart explosionSpeed={350} />
              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                <View style={styles.celebIcon}><MaterialCommunityIcons name="trophy" size={40} color={colors.brandPrimary} /></View>
                <Text style={styles.storyTitle}>{result.entry.story_title}</Text>
                <Text style={styles.story}>{result.entry.story}</Text>

                {result.money_saved_cents > 0 && (
                  <View style={styles.savedCard}>
                    <Text style={styles.savedLabel}>YOU SAVED VS HIRING A PRO</Text>
                    <Text style={styles.savedAmt}>{money(result.money_saved_cents)}</Text>
                    <Text style={styles.savedSub}>Pro estimate {money(result.pro_cost_cents)}</Text>
                  </View>
                )}

                {result.new_achievements.length > 0 && (
                  <>
                    <Text style={styles.achHead}>NEW ACHIEVEMENTS</Text>
                    {result.new_achievements.map((a) => (
                      <View key={a.id} style={styles.achRow}>
                        <View style={styles.achIcon}><MaterialCommunityIcons name={a.icon as any} size={22} color={colors.brandPrimary} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.achTitle}>{a.title}</Text>
                          <Text style={styles.achDesc}>{a.desc}</Text>
                        </View>
                        <MaterialCommunityIcons name="check-decagram" size={20} color={colors.success} />
                      </View>
                    ))}
                  </>
                )}

                <Pressable testID="completion-done" style={styles.cta} onPress={finish}>
                  <Text style={styles.ctaText}>VIEW MY JOURNEY</Text>
                  <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
                </Pressable>
              </ScrollView>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%", paddingTop: spacing.sm },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  trophy: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  row: { flexDirection: "row", gap: spacing.md },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginBottom: spacing.xs, marginTop: spacing.sm },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md },
  dollar: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.lg },
  numInput: { flex: 1, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  soloInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md },
  stars: { flexDirection: "row", gap: spacing.sm },
  textArea: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 70, textAlignVertical: "top", color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  photoRow: { flexDirection: "row", gap: spacing.md },
  photoBox: { flex: 1, aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden", gap: 4 },
  photo: { width: "100%", height: "100%" },
  photoLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  shareRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  shareTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  shareSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.lg },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  resultWrap: { flex: 1 },
  celebIcon: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  storyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, textAlign: "center", marginTop: spacing.sm },
  story: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 24, textAlign: "center" },
  savedCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.success, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, alignItems: "center", marginTop: spacing.md },
  savedLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  savedAmt: { color: colors.success, fontFamily: font.display, fontSize: 44, lineHeight: 48 },
  savedSub: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  achHead: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5, marginTop: spacing.md },
  achRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  achIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  achTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  achDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
