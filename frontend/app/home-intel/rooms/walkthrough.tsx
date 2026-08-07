import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function Walkthrough() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Walkthrough" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.hero}><MaterialCommunityIcons name="home-search-outline" size={44} color={colors.brandPrimary} /></View>
        <Text style={styles.title}>Walk through your home with Homie</Text>
        <Text style={styles.sub}>We&apos;ll identify rooms, save useful details, and organize your home automatically. Go one room at a time — stop and continue whenever you like.</Text>

        <Pressable testID="wt-start-here" style={styles.primary} onPress={() => router.push("/home-intel/rooms/capture")}>
          <Text style={styles.primaryText}>Start Where I Am</Text>
        </Pressable>
        <Pressable testID="wt-choose" style={styles.secondary} onPress={() => router.push("/home-intel/rooms/capture?manual=1")}>
          <Text style={styles.secondaryText}>Choose a Room Manually</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { alignSelf: "center", width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"], textAlign: "center" },
  sub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, textAlign: "center", marginTop: spacing.md },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  secondary: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
});
