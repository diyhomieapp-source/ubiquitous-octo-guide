import { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing, Platform } from "react-native";
import { Image } from "expo-image";

import { colors } from "@/src/theme";

const FACE = require("../../assets/homie-avatar.png");

export type HomiePose = "idle" | "listening" | "thinking" | "talking" | "celebrating";

/**
 * Homie's face, everywhere — the uploaded avatar in a circular frame with a
 * lightweight pose animation per context. Purely transform-based so the same
 * PNG reads as different "poses" (chat, voice, celebration).
 */
export function HomieFace({ size = 48, pose = "idle", ring = true }: { size?: number; pose?: HomiePose; ring?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    v.setValue(0);
    const native = Platform.OS !== "web";
    let loop: Animated.CompositeAnimation;
    if (pose === "talking") {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]));
    } else if (pose === "celebrating") {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]));
    } else {
      // idle / listening / thinking — slow breathe or sway
      loop = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: pose === "thinking" ? 1400 : 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: pose === "thinking" ? 1400 : 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]));
    }
    loop.start();
    return () => loop.stop();
  }, [pose, v]);

  const transform: any[] = [];
  if (pose === "talking") {
    transform.push({ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.04] }) });
    transform.push({ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) });
  } else if (pose === "celebrating") {
    transform.push({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-7deg", "7deg"] }) });
    transform.push({ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) });
  } else if (pose === "thinking") {
    transform.push({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-4deg", "4deg"] }) });
  } else if (pose === "listening") {
    transform.push({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "5deg"] }) });
    transform.push({ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) });
  } else {
    transform.push({ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.03] }) });
  }

  return (
    <View style={[styles.frame, ring && styles.ringOn, { width: size, height: size, borderRadius: size / 2 }]}>
      <Animated.View style={[styles.inner, { transform }]}>
        {/* zoom slightly so shoulders bleed past the circular mask */}
        <Image source={FACE} style={{ width: size * 1.14, height: size * 1.14, marginTop: size * 0.04 }} contentFit="cover" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: "#1B1B1B", alignItems: "center", justifyContent: "center" },
  ringOn: { borderWidth: 1.5, borderColor: colors.brandPrimary + "77" },
  inner: { alignItems: "center", justifyContent: "center" },
});
