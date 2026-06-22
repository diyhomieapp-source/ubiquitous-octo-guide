import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function NotificationsScreen() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Notifications" />
      <View style={styles.empty}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="bell-outline" size={48} color={colors.brandPrimary} />
        </View>
        <Text style={styles.title}>YOU'RE ALL CAUGHT UP</Text>
        <Text style={styles.sub}>
          Project reminders, weather alerts for your outdoor jobs, and updates from Homie will show up here.
        </Text>
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
