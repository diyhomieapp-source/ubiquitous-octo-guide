import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, font, type } from "@/src/theme";

export function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="screen-back-button" onPress={() => router.back()} hitSlop={10} style={styles.back}>
        <MaterialCommunityIcons name="chevron-left" size={26} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.back} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomColor: colors.border, borderBottomWidth: 1, backgroundColor: colors.surface,
  },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
});
