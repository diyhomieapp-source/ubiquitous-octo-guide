import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, font } from "@/src/theme";

type Size = "sm" | "md" | "lg";

export function Logo({ size = "md", showWordmark = true }: { size?: Size; showWordmark?: boolean }) {
  const dim = size === "lg" ? 64 : size === "sm" ? 38 : 50;
  const icon = size === "lg" ? 34 : size === "sm" ? 20 : 27;
  const word = size === "lg" ? 38 : size === "sm" ? 22 : 30;
  const bolt = size === "lg" ? 26 : size === "sm" ? 16 : 20;

  return (
    <View style={styles.row}>
      <View style={[styles.tile, { width: dim, height: dim, borderRadius: dim * 0.3 }]}>
        <MaterialCommunityIcons name="home-variant" size={icon} color={colors.onBrandPrimary} />
        <View style={[styles.badge, { width: bolt, height: bolt, borderRadius: bolt / 2, right: -bolt * 0.2, bottom: -bolt * 0.2 }]}>
          <MaterialCommunityIcons name="wrench" size={bolt * 0.6} color={colors.brandPrimary} />
        </View>
      </View>
      {showWordmark && (
        <Text style={[styles.word, { fontSize: word }]}>
          DIY<Text style={{ color: colors.brandPrimary }}>homie</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  tile: {
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bolt: { position: "absolute", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.onBrandPrimary },
  word: { color: colors.onSurface, fontFamily: font.bold, letterSpacing: -1 },
});
