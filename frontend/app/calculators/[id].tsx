import { ScrollView, View, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { CalculatorRunner } from "@/src/components/CalculatorRunner";
import { getCalculator } from "@/src/calculators/registry";

export default function CalculatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const calc = getCalculator(id);
  return (
    <View style={styles.root}>
      <ScreenHeader title={calc?.name || "Calculator"} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <CalculatorRunner calcId={id} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.surface } });
