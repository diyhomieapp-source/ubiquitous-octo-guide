import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { CONTACT } from "@/src/content/appContent";

export default function ContactScreen() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Contact Us" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>We're here to help with anything — billing, a tricky guide, or just feedback.</Text>

        <Pressable testID="contact-email" style={styles.card} onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}>
          <MaterialCommunityIcons name="email-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Email us</Text>
            <Text style={styles.cardSub}>{CONTACT.email}</Text>
          </View>
          <MaterialCommunityIcons name="open-in-new" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="contact-ticket" style={styles.card} onPress={() => router.push("/support/ticket")}>
          <MaterialCommunityIcons name="ticket-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Submit a support ticket</Text>
            <Text style={styles.cardSub}>Track your request in-app.</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.hours}>{CONTACT.hours}</Text>

        <Text style={styles.followLabel}>FOLLOW US</Text>
        <View style={styles.socials}>
          {CONTACT.socials.map((s) => (
            <Pressable key={s.label} testID={`contact-social-${s.label}`} style={styles.social} onPress={() => Linking.openURL(s.url)}>
              <MaterialCommunityIcons name={s.icon as any} size={22} color={colors.onSurface} />
              <Text style={styles.socialText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.xl, paddingBottom: spacing["3xl"] },
  lead: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 22, marginBottom: spacing.xl },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  hours: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm, marginBottom: spacing.xl },
  followLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginBottom: spacing.md },
  socials: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  social: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  socialText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
});
