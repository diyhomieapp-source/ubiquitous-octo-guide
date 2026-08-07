import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

type Asset = { id: string; name: string; category: string };

export default function HelpScreen() {
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId?: string }>();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<string | null>(assetId || null);
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emergency, setEmergency] = useState<{ danger_type?: string | null } | null>(null);

  const load = useCallback(async () => {
    try { const d = await api<{ assets: Asset[] }>("/hi/assets"); setAssets(d.assets); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addPhoto = () => {
    Alert.alert("Add photo", "Show us the problem", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap a photo of the problem."); if (b) setPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo of the problem."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const voiceNote = () => {
    Alert.alert("Voice input", "Voice-to-text works in the installed DIYhomie app on your phone. For now, please type what's happening below.");
  };

  const submit = async () => {
    if (!desc.trim()) { Alert.alert("Describe the issue", "Tell us what is happening."); return; }
    setSubmitting(true);
    try {
      const r = await api<{ id: string; is_emergency: boolean; danger_type?: string | null }>("/hi/issues", {
        method: "POST", body: { asset_id: selected || undefined, user_description: desc.trim(), image_base64: photo || undefined },
      });
      if (r.is_emergency) { setEmergency({ danger_type: r.danger_type }); }
      else { router.replace(`/home-intel/guidance?issueId=${r.id}`); }
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); }
    finally { setSubmitting(false); }
  };

  if (emergency) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Safety Alert" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.emergCard}>
            <MaterialCommunityIcons name="alert-octagon" size={48} color={colors.onError} />
            <Text style={styles.emergTitle}>STOP — this may be dangerous</Text>
            <Text style={styles.emergSub}>What you described{emergency.danger_type ? ` (${emergency.danger_type})` : ""} can be life-threatening. Do NOT attempt a DIY repair.</Text>
          </View>
          <Text style={styles.emergStep}>1. Leave the area immediately and get everyone out.</Text>
          <Text style={styles.emergStep}>2. Do NOT switch anything on/off or use open flames.</Text>
          <Text style={styles.emergStep}>3. From a safe place, call your local emergency services or utility company.</Text>
          <Text style={styles.emergStep}>4. Do not return until a professional confirms it is safe.</Text>

          <Pressable testID="hi-emerg-call" style={styles.emergBtn} onPress={() => Linking.openURL("tel:911")}>
            <MaterialCommunityIcons name="phone" size={20} color={colors.onError} />
            <Text style={styles.emergBtnText}>Call emergency services</Text>
          </Pressable>
          <Pressable testID="hi-emerg-pro" style={styles.emergSecondary} onPress={() => router.push("/pros")}>
            <Text style={styles.emergSecondaryText}>Find a licensed professional</Text>
          </Pressable>
          <Pressable testID="hi-emerg-back" style={styles.emergSecondary} onPress={() => router.replace("/home-intel")}>
            <Text style={styles.emergSecondaryText}>Back to safety</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Get Help" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.q}>Describe what is happening.</Text>

          {assets.length > 0 && (
            <>
              <Text style={styles.label}>Which asset? (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xs }}>
                <Pressable testID="hi-asset-none" style={[styles.chip, !selected && styles.chipOn]} onPress={() => setSelected(null)}>
                  <Text style={[styles.chipText, !selected && styles.chipTextOn]}>None</Text>
                </Pressable>
                {assets.map((a) => (
                  <Pressable key={a.id} testID={`hi-pick-${a.id}`} style={[styles.chip, selected === a.id && styles.chipOn]} onPress={() => setSelected(a.id)}>
                    <Text style={[styles.chipText, selected === a.id && styles.chipTextOn]}>{a.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          <TextInput
            testID="hi-issue-input"
            style={styles.textArea}
            value={desc}
            onChangeText={setDesc}
            placeholder="e.g. My water heater only gives lukewarm water and the pilot keeps going out."
            placeholderTextColor={colors.onSurfaceTertiary}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.actionsRow}>
            <Pressable testID="hi-issue-voice" style={styles.iconBtn} onPress={voiceNote}>
              <MaterialCommunityIcons name="microphone-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.iconBtnText}>Voice</Text>
            </Pressable>
            <Pressable testID="hi-issue-photo" style={styles.iconBtn} onPress={addPhoto}>
              <MaterialCommunityIcons name="camera-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.iconBtnText}>{photo ? "Photo added" : "Add photo"}</Text>
            </Pressable>
          </View>
          {photo && <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.preview} contentFit="cover" />}

          <Text style={styles.safetyNote}>⚠ If you notice gas, smoke, fire, sparks, flooding or anything unsafe, stop and describe it — we&apos;ll switch to emergency guidance.</Text>

          <Pressable testID="hi-issue-submit" style={[styles.submitBtn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={submit}>
            {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Get safe guidance</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  q: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"], marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  textArea: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.lg, minHeight: 130, marginTop: spacing.md },
  actionsRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtnText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  preview: { width: "100%", height: 160, borderRadius: radius.md, marginTop: spacing.md },
  safetyNote: { color: colors.warning, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.lg },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.lg },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  // emergency
  emergCard: { backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.xl, alignItems: "center" },
  emergTitle: { color: colors.onError, fontFamily: font.display, fontSize: type["2xl"], marginTop: spacing.sm, textAlign: "center" },
  emergSub: { color: colors.onError, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.sm, textAlign: "center", lineHeight: 22 },
  emergStep: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 24, marginTop: spacing.md },
  emergBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.xl },
  emergBtnText: { color: colors.onError, fontFamily: font.bold, fontSize: type.lg },
  emergSecondary: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md },
  emergSecondaryText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
});
