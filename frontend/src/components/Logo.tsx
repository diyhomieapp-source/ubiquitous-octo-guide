import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, font } from "@/src/theme";

type Size = "sm" | "md" | "lg";

export function Logo({ size = "md", showWordmark = true }: { size?: Size; showWordmark?: boolean }) {
  const dim = size === "lg" ? 64 : size === "sm" ? 38 : 50;
  const icon = size === "lg" ? 34 : size === "sm" ? 20 : 27;
  const word = size === "lg" ? 38 : size === "sm" ? 22 : 30;
  const bolt = size === "lg" ? 14 : size === "sm" ? 9 : 11;

  return (
    <View style={styles.row}>
      <View style={[styles.tile, { width: dim, height: dim, borderRadius: dim * 0.3 }]}>
        <MaterialCommunityIcons name="hammer-screwdriver" size={icon} color={colors.onBrandPrimary} />
        <View style={[styles.bolt, { width: bolt, height: bolt, borderRadius: bolt / 2, top: dim * 0.16, right: dim * 0.16 }]} />
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
  bolt: { position: "absolute", backgroundColor: colors.onBrandPrimary, opacity: 0.9 },
  word: { color: colors.onSurface, fontFamily: font.bold, letterSpacing: -1 },
});
