import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { LANGUAGES, metaFor } from "@/src/i18n/languages";
import i18n, { setLanguage, resetToDeviceLanguage } from "@/src/i18n";
import { useAuth } from "@/src/auth";

export default function LanguageScreen() {
  const { t } = useTranslation();
  const { updateProfile } = useAuth();
  const [current, setCurrent] = useState(i18n.language);

  const sync = async (code: string) => {
    setCurrent(code);
    try { await updateProfile({ language: metaFor(code).label }); } catch {}
  };

  const pick = async (code: string) => {
    Haptics.selectionAsync();
    await setLanguage(code);
    await sync(code);
  };

  const auto = async () => {
    Haptics.selectionAsync();
    const code = await resetToDeviceLanguage();
    await sync(code);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={t("language.title")} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{t("language.subtitle")}</Text>

        <Pressable testID="lang-auto" style={styles.autoRow} onPress={auto}>
          <MaterialCommunityIcons name="cellphone-cog" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.autoTitle}>{t("language.auto")}</Text>
            <Text style={styles.autoHint}>{t("language.autoHint")}</Text>
          </View>
        </Pressable>

        <Text style={styles.section}>{t("language.all")}</Text>
        {LANGUAGES.map((l) => {
          const on = current === l.code;
          return (
            <Pressable key={l.code} testID={`lang-${l.code}`} style={[styles.row, on && styles.rowOn]} onPress={() => pick(l.code)}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.native, on && { color: colors.brandPrimary }]}>{l.native}</Text>
                <Text style={styles.label}>{l.label}</Text>
              </View>
              {on && <MaterialCommunityIcons name="check-circle" size={22} color={colors.brandPrimary} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.lg },
  autoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg },
  autoTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  autoHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  rowOn: { backgroundColor: colors.surfaceSecondary, borderBottomColor: "transparent" },
  native: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
