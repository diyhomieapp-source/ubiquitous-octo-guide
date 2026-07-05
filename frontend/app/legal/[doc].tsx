import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, spacing, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { LEGAL, CONTACT } from "@/src/content/appContent";

export default function LegalDocScreen() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const data = LEGAL[doc || "disclaimer"] || LEGAL.disclaimer;

  return (
    <View style={styles.root}>
      <ScreenHeader title={data.title} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>{data.updated}</Text>
        {data.sections.map((s, i) => (
          <View key={i} style={{ marginBottom: spacing.lg }}>
            {!!s.heading && <Text style={styles.heading}>{s.heading}</Text>}
            <Text style={styles.text}>{s.text}</Text>
          </View>
        ))}
        <Text style={styles.footer}>Questions? Email {CONTACT.email}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.xl, paddingBottom: spacing["3xl"] },
  updated: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.xl },
  heading: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  text: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22 },
  footer: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.lg },
});
