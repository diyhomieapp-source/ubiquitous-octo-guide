import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, font } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Accordion } from "@/src/components/Accordion";
import { KNOWLEDGE_BASE } from "@/src/content/appContent";

export default function KnowledgeBaseScreen() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Knowledge Base" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {KNOWLEDGE_BASE.map((group) => (
          <View key={group.category} style={{ marginBottom: spacing.xl }}>
            <Text style={styles.category}>{group.category.toUpperCase()}</Text>
            <Accordion items={group.articles} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  category: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, letterSpacing: 1.5, marginBottom: spacing.sm },
});
