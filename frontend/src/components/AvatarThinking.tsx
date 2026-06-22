import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { AvatarState, GENERATION_SEQUENCE, randomPhrase } from "@/src/avatar/avatarStates";

type Props = {
  sequence?: AvatarState[];
  done?: boolean;
  doneState?: AvatarState;
  stageMs?: number;
};

/**
 * Visual representation of what Homie is "thinking". Walks through a sequence of
 * states while work is in flight, rotating reassuring phrases for each state.
 */
export function AvatarThinking({
  sequence = GENERATION_SEQUENCE,
  done = false,
  doneState = "READY",
  stageMs = 2800,
}: Props) {
  const [i, setI] = useState(0);
  const [phrase, setPhrase] = useState(randomPhrase(sequence[0]));
  const fade = useRef(new Animated.Value(1)).current;

  const current: AvatarState = done ? doneState : sequence[Math.min(i, sequence.length - 1)];

  // advance through stages
  useEffect(() => {
    if (done || i >= sequence.length - 1) return;
    const t = setTimeout(() => setI((n) => n + 1), stageMs);
    return () => clearTimeout(t);
  }, [i, done, sequence, stageMs]);

  // rotate phrase on state change + periodically
  useEffect(() => {
    const swap = (p: string) => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setPhrase(p);
        Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    };
    swap(randomPhrase(current));
    if (done) return;
    const iv = setInterval(() => swap(randomPhrase(current)), 2300);
    return () => clearInterval(iv);
  }, [current, done, fade]);

  const filled = done ? sequence.length : i + 1;

  return (
    <View style={styles.wrap}>
      <Logo size="lg" showWordmark={false} />
      <Animated.Text style={[styles.phrase, { opacity: fade }]}>{phrase}</Animated.Text>
      <View style={styles.dots}>
        {sequence.map((_, idx) => (
          <View key={idx} style={[styles.dot, idx < filled && styles.dotOn]} />
        ))}
      </View>
      <Text style={styles.hint}>{done ? "Tap to begin." : "Homie is on the job — just a few seconds."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl },
  phrase: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, lineHeight: 30, textAlign: "center", minHeight: 60 },
  dots: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.surfaceTertiary },
  dotOn: { backgroundColor: colors.brandPrimary },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
});
