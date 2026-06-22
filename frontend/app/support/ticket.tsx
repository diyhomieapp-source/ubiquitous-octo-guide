import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { TICKET_CATEGORIES } from "@/src/content/appContent";
import { api } from "@/src/api";

export default function TicketScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [category, setCategory] = useState(TICKET_CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError(t("ticket.validation")); return; }
    setError("");
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api<{ id: string }>("/support/ticket", { method: "POST", body: { category, subject: subject.trim(), message: message.trim() } });
      setDone(res.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.message || t("ticket.error"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={t("ticket.title")} />
        <View style={styles.successWrap}>
          <MaterialCommunityIcons name="check-decagram" size={64} color={colors.success} />
          <Text style={styles.successTitle}>{t("ticket.sentTitle")}</Text>
          <Text style={styles.successSub}>{t("ticket.sentSub", { ref: done.slice(0, 8).toUpperCase() })}</Text>
          <Pressable style={styles.cta} onPress={() => router.back()}>
            <Text style={styles.ctaText}>{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={t("ticket.title")} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>{t("ticket.about")}</Text>
          <View style={styles.chips}>
            {TICKET_CATEGORIES.map((c) => {
              const on = category === c;
              return (
                <Pressable key={c} testID={`ticket-cat-${c}`} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c)}>
                  <Text style={[styles.chipText, on && { color: colors.onBrandPrimary }]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>{t("ticket.subject")}</Text>
          <TextInput testID="ticket-subject" style={styles.input} placeholder={t("ticket.subjectPlaceholder")} placeholderTextColor={colors.onSurfaceTertiary} value={subject} onChangeText={setSubject} />

          <Text style={styles.label}>{t("ticket.message")}</Text>
          <TextInput testID="ticket-message" style={[styles.input, styles.textarea]} placeholder={t("ticket.messagePlaceholder")} placeholderTextColor={colors.onSurfaceTertiary} value={message} onChangeText={setMessage} multiline />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable testID="ticket-submit" style={styles.cta} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>{t("ticket.send")}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.xl, paddingBottom: spacing["3xl"] },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginBottom: spacing.sm, marginTop: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  textarea: { minHeight: 130, textAlignVertical: "top" },
  error: { color: colors.error, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.md },
  cta: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg + 2, borderRadius: radius.md, alignItems: "center", marginTop: spacing.xl },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  successTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 34, letterSpacing: 1, marginTop: spacing.md },
  successSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 22 },
});
