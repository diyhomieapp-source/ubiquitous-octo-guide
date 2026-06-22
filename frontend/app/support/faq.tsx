import { View, StyleSheet, ScrollView } from "react-native";
import { colors, spacing } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Accordion } from "@/src/components/Accordion";
import { FAQS } from "@/src/content/appContent";

export default function FaqScreen() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="FAQ" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Accordion items={FAQS} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
});
