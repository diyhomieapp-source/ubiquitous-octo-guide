import { useState } from "react";
import { View, Text, StyleSheet, Pressable, LayoutAnimation, Platform, UIManager } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function Accordion({ items }: { items: { title: string; body: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((item, i) => {
        const expanded = open === i;
        return (
          <View key={item.title} style={styles.card}>
            <Pressable
              testID={`accordion-${i}`}
              style={styles.head}
              onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(expanded ? null : i); }}
            >
              <Text style={styles.q}>{item.title}</Text>
              <MaterialCommunityIcons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={colors.brandPrimary} />
            </Pressable>
            {expanded && <Text style={styles.a}>{item.body}</Text>}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.lg, gap: spacing.md },
  q: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  a: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, paddingBottom: spacing.lg },
});
