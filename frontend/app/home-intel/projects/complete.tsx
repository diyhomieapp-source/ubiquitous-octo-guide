import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const RESULTS = [
  { key: "completed", label: "Yes, completed", icon: "check-circle" },
  { key: "unresolved", label: "Not finished", icon: "progress-close" },
  { key: "escalated", label: "Called a pro", icon: "account-hard-hat" },
];

export default function CompleteProject() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = useState("completed");
  const [cost, setCost] = useState(""); const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState(""); const [lessons, setLessons] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addPhoto = () => {
    Alert.alert("Completion photo", "Add a photo of the finished work", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the finished work."); if (b) setPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/hi/projects/${id}/outcome`, { method: "POST", body: {
        result, actual_cost: cost.trim() || undefined, actual_duration: duration.trim() || undefined,
        completion_notes: notes.trim() || undefined, lessons_learned: lessons.trim() || undefined,
        completion_photo_base64: photo || undefined,
      } });
      setSaved(true);
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <View style={styles.root}><ScreenHeader title="Saved" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.doneCard}><MaterialCommunityIcons name="party-popper" size={44} color={colors.brandPrimary} /><Text style={styles.doneTitle}>Saved to your home history</Text></View>
          <Text style={styles.next}>What&apos;s next?</Text>
          <NextBtn testID="next-cleanup" icon="broom" label="Clean up & log leftovers" highlight onPress={() => router.replace(`/home-intel/cleanup?project_id=${id}`)} />
          <NextBtn testID="next-maintenance" icon="calendar-clock" label="Schedule maintenance" onPress={() => Alert.alert("Maintenance", "The Maintenance Scheduler is coming in the next update.")} />
          <NextBtn testID="next-another" icon="plus-circle-outline" label="Start another project" onPress={() => router.replace("/home-intel/projects/start")} />
          <NextBtn testID="next-pro" icon="account-hard-hat" label="Share with a professional" onPress={() => router.replace("/pros")} />
          <NextBtn testID="next-done" icon="home-outline" label="Back to projects" onPress={() => router.replace("/home-intel/projects")} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Complete Project" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.q}>Did you complete this project?</Text>
          <View style={styles.chips}>
            {RESULTS.map((r) => (
              <Pressable key={r.key} testID={`cmp-${r.key}`} style={[styles.rChip, result === r.key && styles.rChipOn]} onPress={() => setResult(r.key)}>
                <MaterialCommunityIcons name={r.icon as any} size={18} color={result === r.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.rChipText, result === r.key && { color: colors.brandPrimary }]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable testID="cmp-photo" style={styles.photoBox} onPress={addPhoto}>
            {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" /> :
              <><MaterialCommunityIcons name="camera-plus-outline" size={26} color={colors.onSurfaceTertiary} /><Text style={styles.hint}>Add completion photo</Text></>}
          </Pressable>

          <Field label="Actual cost"><TextInput testID="cmp-cost" style={styles.input} value={cost} onChangeText={setCost} placeholder="e.g. $45" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Actual duration"><TextInput testID="cmp-duration" style={styles.input} value={duration} onChangeText={setDuration} placeholder="e.g. 2 hours" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Notes"><TextInput testID="cmp-notes" style={[styles.input, { minHeight: 70 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" placeholder="How did it go?" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Lessons learned"><TextInput testID="cmp-lessons" style={[styles.input, { minHeight: 70 }]} value={lessons} onChangeText={setLessons} multiline textAlignVertical="top" placeholder="Anything to remember next time?" placeholderTextColor={colors.onSurfaceTertiary} /></Field>

          <Pressable testID="cmp-save" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save to home history</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <><Text style={styles.label}>{label}</Text>{children}</>; }
function NextBtn({ icon, label, onPress, testID, highlight }: any) {
  return <Pressable testID={testID} style={[styles.nextBtn, highlight && styles.nextBtnHi]} onPress={onPress}><MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} /><Text style={styles.nextText}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} /></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  q: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginBottom: spacing.md },
  chips: { gap: spacing.sm },
  rChip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  rChipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  rChipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  photoBox: { height: 120, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginTop: spacing.lg },
  photo: { width: "100%", height: "100%" },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  doneCard: { alignItems: "center", paddingVertical: spacing.xl },
  doneTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginTop: spacing.md, textAlign: "center" },
  next: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  nextBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  nextBtnHi: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  nextText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
});
