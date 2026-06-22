import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform } from "react-native";
import { Image } from "expo-image";
import { colors, spacing, font } from "@/src/theme";

const LOGO = require("../../assets/logo-contractor.png");

type Size = "sm" | "md" | "lg";

/** A single orange square outline that scales up + fades out — an electric pulse radiating from the logo. */
function Ring({ dim, delay }: { dim: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Apply the stagger delay once, then loop the pulse forever so all rings
    // keep a steady, evenly-spaced continuous radiating cadence.
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" })
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, delay]);

  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const opacity = v.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.75, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: dim, height: dim, borderRadius: dim * 0.26, opacity, transform: [{ scale }] },
      ]}
    />
  );
}

export function Logo({ size = "md", showWordmark = true, animated = true }: { size?: Size; showWordmark?: boolean; animated?: boolean }) {
  const dim = size === "lg" ? 92 : size === "sm" ? 44 : 60;
  const word = size === "lg" ? 40 : size === "sm" ? 22 : 32;

  return (
    <View style={styles.row}>
      <View style={[styles.mark, { width: dim, height: dim }]}>
        {animated && (
          <>
            <Ring dim={dim} delay={0} />
            <Ring dim={dim} delay={730} />
            <Ring dim={dim} delay={1460} />
          </>
        )}
        <Image source={LOGO} style={[styles.tile, { width: dim, height: dim, borderRadius: dim * 0.26 }]} contentFit="cover" />
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
  mark: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 2, borderColor: colors.brandPrimary },
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
  word: { color: colors.onSurface, fontFamily: font.bold, letterSpacing: -1 },
});
