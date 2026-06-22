import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";

const BADGE_META: Record<string, { icon: string; color: string }> = {
  "Verified Pro": { icon: "shield-check", color: "#29B6F6" },
  "Master Builder": { icon: "crown", color: "#FFC400" },
  "Experienced DIYer": { icon: "hammer", color: "#FF8A50" },
  "Verified Installer": { icon: "wrench", color: "#00E676" },
  "Verified Owner": { icon: "home-account", color: "#A0A0A5" },
  "Weekend Warrior": { icon: "rocket", color: "#FF8A50" },
};

export function Badge({ label, small }: { label?: string | null; small?: boolean }) {
  if (!label) return null;
  const m = BADGE_META[label] || { icon: "account", color: colors.onSurfaceTertiary };
  return (
    <View style={[styles.badge, { borderColor: m.color }]}>
      <MaterialCommunityIcons name={m.icon as any} size={small ? 11 : 13} color={m.color} />
      <Text style={[styles.badgeText, { color: m.color, fontSize: small ? 9 : 10 }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function dollars(cents?: number | null) {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100)}`;
}

export function duration(min?: number | null) {
  if (min == null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function compact(n?: number | null) {
  if (n == null) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontFamily: font.bold, letterSpacing: 0.4 },
});
