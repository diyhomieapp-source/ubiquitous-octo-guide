import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { track } from "@/src/utils/analytics";

const LABELS: Record<string, string> = {
  home: "homes", project: "saved projects", chat: "today's Homie chats",
  inventory: "inventory items", document: "vault documents",
};

type FeatureKey = keyof typeof LABELS;
type Nudge = { ratio: number; used: number; limit: number; label: string };

/**
 * Gentle "almost at your limit" banner. Renders nothing for Pro users or when
 * no tracked feature is >= 80% of its plan limit. Pass `feature` to focus on a
 * single feature (e.g. "chat" inside the chat screen); omit to show the most
 * consumed one (used on the dashboard).
 */
export function UpgradeNudge({ feature }: { feature?: FeatureKey }) {
  const router = useRouter();
  const [nudge, setNudge] = useState<Nudge | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api<{ tier: string; usage: Record<string, { used: number | null; limit: number }> }>("/hi/subscription/me");
      if (s.tier === "pro") { setNudge(null); return; }
      const keys = feature ? [feature] : Object.keys(LABELS);
      let best: Nudge | null = null;
      for (const k of keys) {
        const u = s.usage[k];
        if (!u || u.limit === -1 || u.used == null) continue;
        const ratio = u.used / u.limit;
        if (ratio >= 0.8 && (!best || ratio > best.ratio)) best = { ratio, used: u.used, limit: u.limit, label: LABELS[k] };
      }
      setNudge(best);
      if (best) track("upgrade_prompt_shown", { feature: feature || best.label, current_tier: s.tier });
    } catch {}
  }, [feature]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!nudge) return null;
  return (
    <Pressable testID="hi-upgrade-nudge" style={styles.nudge} onPress={() => router.push("/home-intel/upgrade")}>
      <MaterialCommunityIcons name="arrow-up-circle-outline" size={22} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{nudge.used >= nudge.limit ? `You've reached your ${nudge.label} limit` : `You're almost out of ${nudge.label}`}</Text>
        <Text style={styles.sub}>{nudge.used} of {nudge.limit} used · tap to see plans</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nudge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderColor: colors.warning + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
