import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors, spacing, font } from "@/src/theme";

const LOGO = require("../../assets/logo-contractor.png");

type Size = "sm" | "md" | "lg";

export function Logo({ size = "md", showWordmark = true }: { size?: Size; showWordmark?: boolean }) {
  const dim = size === "lg" ? 92 : size === "sm" ? 44 : 60;
  const word = size === "lg" ? 40 : size === "sm" ? 22 : 32;

  return (
    <View style={styles.row}>
      <Image source={LOGO} style={[styles.tile, { width: dim, height: dim, borderRadius: dim * 0.26 }]} contentFit="cover" />
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
