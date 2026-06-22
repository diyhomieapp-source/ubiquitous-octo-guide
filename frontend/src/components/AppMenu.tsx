import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { CONTACT, DISCLAIMER_SHORT } from "@/src/content/appContent";

const HELP = [
  { label: "FAQ", icon: "frequently-asked-questions", route: "/support/faq" },
  { label: "Knowledge Base", icon: "book-open-variant", route: "/support/knowledge-base" },
  { label: "Contact Us", icon: "email-outline", route: "/support/contact" },
  { label: "Submit a Support Ticket", icon: "ticket-outline", route: "/support/ticket" },
];
const LEGAL = [
  { label: "Terms of Service", icon: "file-document-outline", route: "/legal/terms" },
  { label: "Privacy Policy", icon: "shield-lock-outline", route: "/legal/privacy" },
  { label: "Disclaimer", icon: "alert-outline", route: "/legal/disclaimer" },
];

export function AppMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const go = (route: string) => { onClose(); setTimeout(() => router.push(route as any), 120); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.topRow}>
            <Text style={styles.brand}>MENU</Text>
            <Pressable testID="menu-close" onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={26} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>HELP & SUPPORT</Text>
            {HELP.map((it) => (
              <Pressable key={it.label} testID={`menu-${it.route}`} style={styles.item} onPress={() => go(it.route)}>
                <MaterialCommunityIcons name={it.icon as any} size={20} color={colors.brandPrimary} />
                <Text style={styles.itemText}>{it.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}

            <Text style={styles.section}>LEGAL</Text>
            {LEGAL.map((it) => (
              <Pressable key={it.label} testID={`menu-${it.route}`} style={styles.item} onPress={() => go(it.route)}>
                <MaterialCommunityIcons name={it.icon as any} size={20} color={colors.brandPrimary} />
                <Text style={styles.itemText}>{it.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.followLabel}>FOLLOW DIYHOMIE</Text>
              <View style={styles.socials}>
                {CONTACT.socials.map((s) => (
                  <Pressable key={s.label} testID={`social-${s.label}`} style={styles.social} onPress={() => Linking.openURL(s.url)}>
                    <MaterialCommunityIcons name={s.icon as any} size={22} color={colors.onSurface} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.disclaimer}>{DISCLAIMER_SHORT}</Text>
              <Text style={styles.copy}>© {new Date().getFullYear()} DIYhomie · v1.0.0</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { width: "84%", maxWidth: 360, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, borderLeftColor: colors.border, borderLeftWidth: 1 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  brand: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  itemText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg },
  footer: { marginTop: spacing["2xl"], borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.lg, gap: spacing.md },
  followLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  socials: { flexDirection: "row", gap: spacing.md },
  social: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  copy: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
