import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const TYPES: { key: string; label: string; icon: string }[] = [
  { key: "bug", label: "Bug", icon: "bug-outline" },
  { key: "feature", label: "Idea", icon: "lightbulb-on-outline" },
  { key: "other", label: "Other", icon: "comment-outline" },
];

export function FeedbackFab() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("feature");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!user) return null;

  const reset = () => { setMessage(""); setType("feature"); setDone(false); };
  const close = () => { setOpen(false); setTimeout(reset, 250); };

  const submit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api("/feedback", { method: "POST", body: { type, message: message.trim(), platform: Platform.OS } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
    } catch {} finally { setBusy(false); }
  };

  return (
    <>
      <Pressable testID="feedback-fab" style={[styles.fab, { bottom: insets.bottom + 78 }]} onPress={() => setOpen(true)}>
        <MaterialCommunityIcons name="message-plus-outline" size={22} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            {done ? (
              <View style={styles.doneWrap}>
                <MaterialCommunityIcons name="check-decagram" size={56} color={colors.success} />
                <Text style={styles.doneTitle}>THANK YOU!</Text>
                <Text style={styles.doneSub}>Your feedback goes straight to the team. It genuinely shapes what we build next.</Text>
                <Pressable testID="feedback-done" style={styles.submit} onPress={close}><Text style={styles.submitText}>DONE</Text></Pressable>
              </View>
            ) : (
              <>
                <View style={styles.head}>
                  <Text style={styles.title}>Share feedback</Text>
                  <Pressable testID="feedback-close" onPress={close} hitSlop={10}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
                </View>
                <Text style={styles.label}>WHAT'S THIS ABOUT?</Text>
                <View style={styles.typeRow}>
                  {TYPES.map((t) => {
                    const on = type === t.key;
                    return (
                      <Pressable key={t.key} testID={`feedback-type-${t.key}`} style={[styles.typeChip, on && styles.typeChipOn]} onPress={() => setType(t.key)}>
                        <MaterialCommunityIcons name={t.icon as any} size={18} color={on ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                        <Text style={[styles.typeText, on && { color: colors.onBrandPrimary }]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  testID="feedback-input"
                  style={styles.input}
                  placeholder={type === "bug" ? "What went wrong? What did you expect?" : "Tell us your idea or thoughts…"}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  autoFocus
                />
                <Pressable testID="feedback-submit" style={[styles.submit, (!message.trim() || busy) && { opacity: 0.5 }]} onPress={submit} disabled={!message.trim() || busy}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>SEND</Text>}
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: { position: "absolute", right: spacing.lg, width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6, zIndex: 50 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, letterSpacing: 0.5 },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  typeRow: { flexDirection: "row", gap: spacing.sm },
  typeChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1, justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md },
  typeChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, minHeight: 110, textAlignVertical: "top", color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  submit: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center", marginTop: spacing.sm },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  doneWrap: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  doneTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1 },
  doneSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 21, paddingHorizontal: spacing.md },
});
