import { useState, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, Dimensions } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import ConfettiCannon from "react-native-confetti-cannon";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { HomieFace } from "@/src/components/HomieFace";
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
  const [celebration, setCelebration] = useState<any>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const celTimer = useRef<any>(null);

  const endCelebration = async (action: "skipped" | "completed") => {
    if (celTimer.current) { clearTimeout(celTimer.current); celTimer.current = null; }
    const cid = celebration?.celebration_event_id;
    setCelebration(null);
    if (cid) { try { await api(`/hi/celebration/events/${cid}/${action}`, { method: "POST", body: {} }); } catch {} }
  };

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
      if (result === "completed") {
        try {
          const cel = await api(`/hi/celebration/projects/${id}/completed`, { method: "POST", body: {} });
          setCompletion(cel.completion || null);
          setAchievements(cel.achievements || []);
          if (cel.celebration && !cel.already_recorded) {
            setCelebration(cel.celebration);
            const ms = (cel.celebration.duration_seconds || 7) * 1000;
            celTimer.current = setTimeout(() => endCelebration("completed"), ms);
          }
        } catch {}
      }
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <View style={styles.root}><ScreenHeader title="Saved" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.doneCard}>
            <MaterialCommunityIcons name="party-popper" size={44} color={colors.brandPrimary} />
            <Text style={styles.doneTitle}>{result === "completed" ? "Project Complete" : "Saved to your home history"}</Text>
            {completion && (
              <View style={styles.summaryBox}>
                {completion.actual_cost != null && <Text style={styles.sumLine}>Materials & costs: ${completion.actual_cost}</Text>}
                {completion.estimated_pro_cost != null && <Text style={styles.sumLine}>Estimated professional cost: ${completion.estimated_pro_cost}</Text>}
                {completion.estimated_savings != null && completion.estimated_savings > 0 && (
                  <Text testID="completion-savings" style={[styles.sumLine, { color: colors.success }]}>Estimated savings: ${completion.estimated_savings}</Text>
                )}
                {completion.estimated_savings != null && <Text style={styles.sumNote}>{completion.savings_note}</Text>}
                <Text style={styles.sumNote}>Saved to your Home Passport.</Text>
              </View>
            )}
            {achievements.length > 0 && (
              <View style={styles.achieveRow}>
                {achievements.map((a) => (
                  <View key={a.id} testID={`achievement-${a.achievement_type}`} style={styles.achieveChip}>
                    <MaterialCommunityIcons name="trophy-outline" size={14} color={colors.warning} />
                    <Text style={styles.achieveText}>{a.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <Text style={styles.next}>What&apos;s next?</Text>
          {result === "completed" && (
            <NextBtn testID="next-share-win" icon="share-variant" label="Share My Win" onPress={() => router.push(`/home-intel/projects/share-win?id=${id}`)} />
          )}
          <NextBtn testID="next-cleanup" icon="broom" label="Clean up & log leftovers" highlight onPress={() => router.replace(`/home-intel/cleanup?project_id=${id}`)} />
          <NextBtn testID="next-maintenance" icon="calendar-clock" label="Schedule maintenance follow-up" onPress={async () => {
            try {
              const res = await api<{ task: { title: string; due_date: string }; created: boolean }>(`/hi/maintenance/followup/from-project/${id}`, { method: "POST", body: {} });
              Alert.alert(res.created ? "Follow-up scheduled" : "Already scheduled", `${res.task.title} — due ${res.task.due_date}.`);
            } catch (e: any) { Alert.alert("Couldn't schedule", e?.message || "Try again."); }
          }} />
          <NextBtn testID="next-another" icon="plus-circle-outline" label="Start another project" onPress={() => router.replace("/home-intel/projects/start")} />
          <NextBtn testID="next-pro" icon="account-hard-hat" label="Share with a professional" onPress={() => router.replace(`/home-intel/projects/pro-help?id=${id}`)} />
          <NextBtn testID="next-done" icon="home-outline" label="Back to projects" onPress={() => router.replace("/home-intel/projects")} />
        </ScrollView>

        {/* Homie celebration overlay (Doc 63 — skippable, asset-driven, reduced-motion aware) */}
        <Modal visible={!!celebration} transparent animationType="fade" onRequestClose={() => endCelebration("skipped")}>
          <Pressable testID="celebration-overlay" style={styles.celWrap} onPress={() => endCelebration("skipped")}>
            {celebration?.play?.effects && (
              <ConfettiCannon count={140} origin={{ x: Dimensions.get("window").width / 2, y: -10 }}
                colors={celebration?.confetti_colors} fadeOut autoStart explosionSpeed={400} fallSpeed={2600} />
            )}
            <View style={styles.celCard}>
              <HomieFace size={110} pose="celebrating" />
              {celebration?.play?.voice && <Text testID="celebration-voice" style={styles.celVoice}>{celebration?.voice_line}</Text>}
              {celebration?.play?.animation && <Text style={styles.celSub}>{celebration?.subtitle}</Text>}
              <Text style={styles.celSkip}>Tap anywhere to skip</Text>
            </View>
          </Pressable>
        </Modal>
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
  summaryBox: { alignSelf: "stretch", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, gap: 2 },
  sumLine: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  sumNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  achieveRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md, justifyContent: "center" },
  achieveChip: { flexDirection: "row", alignItems: "center", gap: 4, borderColor: colors.warning, borderWidth: 1, backgroundColor: colors.warning + "14", borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: spacing.md },
  achieveText: { color: colors.warning, fontFamily: font.bold, fontSize: type.sm },
  celWrap: { flex: 1, backgroundColor: "#000C", alignItems: "center", justifyContent: "center" },
  celCard: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  celVoice: { color: "#FFFFFF", fontFamily: font.display, fontSize: type["2xl"], textAlign: "center" },
  celSub: { color: "#FFFFFFAA", fontFamily: font.medium, fontSize: type.base, textAlign: "center" },
  celSkip: { color: "#FFFFFF66", fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
});
