import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Platform, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { CalculatorRunner } from "@/src/components/CalculatorRunner";
import { getCalculator } from "@/src/calculators/registry";

// Contextual popup — show the right calculator at the perfect moment (from a guide step / AI chat).
export function CalculatorSheet({ calcId, visible, onClose }: { calcId?: string | null; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const calc = getCalculator(calcId || undefined);
  if (!calc) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={styles.headIcon}><MaterialCommunityIcons name={calc.icon as any} size={22} color={colors.brandPrimary} /></View>
            <Text style={styles.title}>{calc.name}</Text>
            <Pressable testID="calc-sheet-close" onPress={onClose} hitSlop={10}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <CalculatorRunner calcId={calc.id} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "90%" },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  headIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
});
