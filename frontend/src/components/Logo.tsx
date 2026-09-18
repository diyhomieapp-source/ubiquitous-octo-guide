import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform, Pressable } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { colors, spacing, font } from "@/src/theme";

const MASCOT = require("../../assets/homie-avatar.png");
// Square headshot PNG (640x640, transparent top corners). The shoulders reach
// the bottom edge, so bottom-aligning against the tile lets the cap pop above
// the tile's top edge.
const MASCOT_AR = 1;

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

export function Logo({ size = "md", showWordmark = true, animated = true, interactive = true }: { size?: Size; showWordmark?: boolean; animated?: boolean; interactive?: boolean }) {
  const dim = size === "lg" ? 92 : size === "sm" ? 44 : 60;
  const word = size === "lg" ? 40 : size === "sm" ? 22 : 32;

  // Mascot is scaled slightly wider than the tile so the cap pops above the
  // top edge while the shoulders sit flush with the tile's bottom.
  const mW = dim * 1.35;
  const mH = mW / MASCOT_AR; // square headshot → ~1.35 * dim
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
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  // Interactive "spring to life" — a springy lean-in on hover (web) / press (mobile).
  // Kept subtle & anchored so the face never leaves the frame and the tile
  // bottom stays covered.
  const engage = useRef(new Animated.Value(0)).current;
  const setEngaged = (on: boolean) => {
    if (!interactive) return;
    if (on && Platform.OS !== "web") Haptics.selectionAsync();
    Animated.spring(engage, {
      toValue: on ? 1 : 0,
      useNativeDriver: Platform.OS !== "web",
      friction: 4,
      tension: 120,
    }).start();
  };

  // Gentle pop + playful tilt (no vertical lift → stays fully framed).
  const mScale = engage.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const mRotate = engage.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-4deg"] });
  const translateY = floatY;
  const tileScale = engage.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.mark, { width: dim, height: dim }]}
        onHoverIn={() => setEngaged(true)}
        onHoverOut={() => setEngaged(false)}
        onPressIn={() => setEngaged(true)}
        onPressOut={() => setEngaged(false)}
      >
        {animated && (
          <>
            <Ring dim={dim} delay={0} />
            <Ring dim={dim} delay={730} />
            <Ring dim={dim} delay={1460} />
          </>
        )}
        {/* orange square (kept) */}
        <Animated.View style={[styles.tile, { width: dim, height: dim, borderRadius: radius, transform: [{ scale: tileScale }] }]} />
        {/* mascot popping out of the top */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mascotWrap,
            { width: mW, height: mH, left: (dim - mW) / 2, bottom: -dim * 0.06, transform: [{ translateY }, { rotate: mRotate }, { scale: mScale }] },
          ]}
        >
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" />
        </Animated.View>
      </Pressable>
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
