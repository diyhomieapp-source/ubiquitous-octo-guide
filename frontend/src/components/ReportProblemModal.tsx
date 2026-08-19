import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const ICONS: Record<string, string> = {
  found_obstruction: "wall", missing_part: "puzzle-remove-outline", measurement_different: "ruler",
  material_does_not_fit: "resize", made_a_mistake: "backup-restore", something_damaged: "image-broken-variant",
  unsure_what_to_do: "help-circle-outline", may_be_unsafe: "shield-alert-outline", other: "dots-horizontal-circle-outline",
};

export function ReportProblemModal({ visible, onClose, projectId, onReported }: {
  visible: boolean; onClose: () => void; projectId: string; onReported?: () => void;
}) {
  const router = useRouter();
  const [types, setTypes] = useState<{ code: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (visible && types.length === 0) {
      api<any>("/hi/workspace/meta").then((m) => setTypes(m.problem_types || [])).catch(() => {});
    }
  }, [visible, types.length]);

  const reset = () => { setSelected(null); setNote(""); setPhoto(null); setResult(null); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api<any>(`/hi/workspace/projects/${projectId}/problem`, {
        method: "POST", body: { problem_type: selected, note: note.trim() || null, photo_base64: photo },
      });
      setResult(res);
      onReported?.();
    } catch {} finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handleRow}>
              <Text style={styles.title}>Something Changed</Text>
              <Pressable testID="rp-close" onPress={close} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>

            {!result ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.body}>Tell me what happened — I&apos;ll adjust the plan, add a task, or bring in help.</Text>
                {types.map((t) => (
                  <Pressable key={t.code} testID={`rp-type-${t.code}`} style={[styles.typeRow, selected === t.code && styles.typeRowActive]} onPress={() => setSelected(t.code)}>
                    <MaterialCommunityIcons name={(ICONS[t.code] || "alert-circle-outline") as any} size={20} color={selected === t.code ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    <Text style={styles.typeLabel}>{t.label}</Text>
                    <MaterialCommunityIcons name={selected === t.code ? "radiobox-marked" : "radiobox-blank"} size={18} color={selected === t.code ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  </Pressable>
                ))}
                <TextInput
                  testID="rp-note"
                  style={styles.input}
                  placeholder="Describe what you found (optional)"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={note}
                  onChangeText={setNote}
                  multiline
                />
                <View style={styles.photoRow}>
                  <Pressable testID="rp-photo-camera" style={styles.photoBtn} onPress={async () => { const b = await takePhoto("Add a photo of the problem area."); if (b) setPhoto(b); }}>
                    <MaterialCommunityIcons name="camera-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.photoText}>Take Photo</Text>
                  </Pressable>
                  <Pressable testID="rp-photo-library" style={styles.photoBtn} onPress={async () => { const b = await pickFromLibrary("Add a photo of the problem area."); if (b) setPhoto(b); }}>
                    <MaterialCommunityIcons name="image-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.photoText}>Add Photo</Text>
                  </Pressable>
                </View>
                {photo && <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.preview} contentFit="cover" />}
                <Pressable testID="rp-submit" style={[styles.primaryBtn, !selected && { opacity: 0.5 }]} disabled={!selected || busy} onPress={submit}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Report & Get Guidance</Text>}
                </Pressable>
              </ScrollView>
            ) : (
              <ScrollView>
                <View style={[styles.resultCard, result.route === "pro_review" && { borderColor: colors.error + "88" }]}>
                  <MaterialCommunityIcons
                    name={result.route === "pro_review" ? "shield-alert-outline" : "robot-happy-outline"}
                    size={28} color={result.route === "pro_review" ? colors.error : colors.brandPrimary} />
                  <Text style={styles.resultMsg}>{result.message}</Text>
                  <Text style={styles.stateLine}>Project state: {result.state?.label}</Text>
                </View>
                {(result.actions || []).includes("bring_in_pro") && (
                  <Pressable testID="rp-pro" style={styles.primaryBtn} onPress={() => { close(); router.push("/pros"); }}>
                    <Text style={styles.primaryText}>Bring In a Pro</Text>
                  </Pressable>
                )}
                <Pressable testID="rp-done" style={styles.outlineBtn} onPress={close}>
                  <Text style={styles.outlineText}>Back to Project</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "88%" },
  handleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  typeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, borderWidth: 1, borderColor: "transparent", minHeight: 48 },
  typeRowActive: { borderColor: colors.brandPrimary },
  typeLabel: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 64, textAlignVertical: "top", marginTop: spacing.sm },
  photoRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.brandPrimary + "66", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  photoText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  preview: { width: 96, height: 96, borderRadius: radius.md, marginTop: spacing.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, minHeight: 48, marginTop: spacing.sm },
  outlineText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  resultCard: { alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brandPrimary + "44", borderRadius: radius.lg, padding: spacing.lg },
  resultMsg: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, textAlign: "center", lineHeight: 22 },
  stateLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs },
});
