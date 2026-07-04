import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform } from "react-native";
import { Image } from "expo-image";
import { colors, spacing, font } from "@/src/theme";

const MASCOT = require("../../assets/homie-mascot.png");
// Full PNG frame aspect (1080x720). The mascot fills the frame vertically
// (cap near the top, shirt at the very bottom), so scaling by this aspect and
// bottom-aligning makes the head pop above the tile's top edge.
const MASCOT_AR = 1080 / 720;

type Size = "sm" | "md" | "lg";

/** A single orange square outline that scales up + fades out — an electric pulse radiating from the logo. */
function Ring({ dim, delay }: { dim: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
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

  // Mascot is scaled wider than the tile so the head/cap pops above the top
  // edge while the shirt/shoulders sit flush with the tile's bottom.
  const mW = dim * 1.9;
  const mH = mW / MASCOT_AR; // ~1.27 * dim → head extends above the square
  const radius = dim * 0.26;

  // Gentle idle float so the avatar feels alive/interactive.
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(float, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [float, animated]);
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

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
        {/* orange square (kept) */}
        <View style={[styles.tile, { width: dim, height: dim, borderRadius: radius }]} />
        {/* mascot popping out of the top */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mascotWrap,
            { width: mW, height: mH, left: (dim - mW) / 2, bottom: -dim * 0.1, transform: [{ translateY }] },
          ]}
        >
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" />
        </Animated.View>
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
  mark: { alignItems: "center", justifyContent: "flex-end" },
  ring: { position: "absolute", borderWidth: 2, borderColor: colors.brandPrimary, bottom: 0 },
  tile: {
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  mascotWrap: {
    position: "absolute",
  },
  mascot: { width: "100%", height: "100%" },
  word: { color: colors.onSurface, fontFamily: font.bold, letterSpacing: -1 },
});
