import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { HomieFace, HomiePose } from "@/src/components/HomieFace";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

const ACCENT: Record<AvatarState, string> = {
  idle: "#FF6A00",
  listening: "#3BA7FF",
  thinking: "#B57BFF",
  speaking: "#FF6A00",
};

/**
 * Full-height presence for the live "Talk to Homie" avatar. This is the mount
 * point that will host the Unity / Reallusion WebGL avatar (ElevenLabs / ConvAI /
 * Cartesia driven). Until that stream is wired, it renders an elegant animated
 * presence so the flow feels alive — intentionally NOT the logo mascot.
 */
function Ring({ size, accent, delay, driver }: { size: number; accent: string; delay: number; driver: Animated.Value }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" })
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const opacity = v.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.5, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: accent, opacity, transform: [{ scale }] }]}
    />
  );
}

export function AvatarStage({ state = "idle", caption }: { state?: AvatarState; caption?: string }) {
  const accent = ACCENT[state];
  const breathe = useRef(new Animated.Value(0)).current;
  const speak = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  // gentle breathing while present
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(breathe, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  // faster pulse when speaking / listening
  useEffect(() => {
    if (state === "speaking" || state === "listening") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(speak, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
          Animated.timing(speak, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    speak.setValue(0);
  }, [state, speak]);

  // rotating shimmer while thinking
  useEffect(() => {
    if (state === "thinking") {
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
      loop.start();
      return () => loop.stop();
    }
    spin.setValue(0);
  }, [state, spin]);

  const coreScale = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }),
    speak.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] })
  );
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const label = state === "listening" ? "LISTENING" : state === "thinking" ? "THINKING" : state === "speaking" ? "SPEAKING" : "LIVE";

  return (
    <View style={styles.stage}>
      <LinearGradient
        colors={["rgba(255,106,0,0.10)", "transparent"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
        pointerEvents="none"
      />

      <View style={styles.presence}>
        <Ring size={240} accent={accent} delay={0} driver={breathe} />
        <Ring size={240} accent={accent} delay={900} driver={breathe} />
        <Ring size={240} accent={accent} delay={1800} driver={breathe} />

        {/* outer aura */}
        <View style={[styles.aura, { shadowColor: accent, backgroundColor: accent + "1A" }]} />

        {/* rotating shimmer while thinking */}
        <Animated.View style={[styles.shimmerWrap, { transform: [{ rotate }] }]} pointerEvents="none">
          <LinearGradient colors={[accent + "00", accent + "88", accent + "00"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.shimmer} />
        </Animated.View>

        {/* breathing core — Homie's face, pose follows the conversation state */}
        <Animated.View style={[styles.core, { borderColor: accent + "66", transform: [{ scale: coreScale }] }]}>
          <LinearGradient colors={["rgba(40,40,40,0.9)", "rgba(10,10,10,0.95)"]} style={StyleSheet.absoluteFill} />
          <HomieFace size={150} ring={false}
            pose={({ speaking: "talking", listening: "listening", thinking: "thinking", idle: "idle" } as Record<AvatarState, HomiePose>)[state]} />
        </Animated.View>

        <View style={[styles.badge, { borderColor: accent + "55" }]}>
          <View style={[styles.badgeDot, { backgroundColor: accent }]} />
          <Text style={[styles.badgeText, { color: accent }]}>HOMIE · {label}</Text>
        </View>
      </View>

      {!!caption && (
        <View style={styles.captionWrap}>
          <Text style={styles.caption}>{caption}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: "center", justifyContent: "center", width: "100%" },
  presence: { alignItems: "center", justifyContent: "center", width: 260, height: 260 },
  ring: { position: "absolute", borderWidth: 1.5 },
  aura: { position: "absolute", width: 210, height: 210, borderRadius: 105, shadowOpacity: 0.9, shadowRadius: 60, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  shimmerWrap: { position: "absolute", width: 190, height: 190, borderRadius: 95, overflow: "hidden", opacity: 0.5 },
  shimmer: { flex: 1 },
  core: { width: 168, height: 168, borderRadius: 84, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  badge: { position: "absolute", bottom: -6, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.6)", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontFamily: "DMSans-Bold", fontSize: 11, letterSpacing: 1.5 },
  captionWrap: { marginTop: 40, paddingHorizontal: 32, minHeight: 60 },
  caption: { color: "rgba(255,255,255,0.92)", fontFamily: "DMSans-Medium", fontSize: 20, lineHeight: 28, textAlign: "center" },
});
