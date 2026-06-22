import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors, spacing, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function NotificationsScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.root}>
      <ScreenHeader title={t("notifications.title")} />
      <View style={styles.empty}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="bell-outline" size={48} color={colors.brandPrimary} />
        </View>
        <Text style={styles.title}>{t("notifications.caughtUp")}</Text>
        <Text style={styles.sub}>{t("notifications.caughtUpSub")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  iconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1, marginTop: spacing.md },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 22 },
});
