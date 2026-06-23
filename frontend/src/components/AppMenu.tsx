import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { CONTACT, DISCLAIMER_SHORT } from "@/src/content/appContent";
import { useAuth } from "@/src/auth";
import i18n from "@/src/i18n";
import { metaFor } from "@/src/i18n/languages";

export function AppMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();

  const HELP = [
    { label: t("menu.faq"), icon: "frequently-asked-questions", route: "/support/faq" },
    { label: t("menu.knowledgeBase"), icon: "book-open-variant", route: "/support/knowledge-base" },
    { label: t("menu.contactUs"), icon: "email-outline", route: "/support/contact" },
    { label: t("menu.supportTicket"), icon: "ticket-outline", route: "/support/ticket" },
  ];
  const LEGAL = [
    { label: t("menu.terms"), icon: "file-document-outline", route: "/legal/terms" },
    { label: t("menu.privacy"), icon: "shield-lock-outline", route: "/legal/privacy" },
    { label: t("menu.disclaimer"), icon: "alert-outline", route: "/legal/disclaimer" },
  ];

  const go = (route: string) => { onClose(); setTimeout(() => router.push(route as any), 120); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.topRow}>
            <Text style={styles.brand}>{t("menu.title")}</Text>
            <Pressable testID="menu-close" onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={26} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
            {user?.is_admin && (
              <Pressable testID="menu-admin" style={[styles.item, { borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }]} onPress={() => go("/admin")}>
                <MaterialCommunityIcons name="shield-crown-outline" size={20} color={colors.brandPrimary} />
                <Text style={[styles.itemText, { color: colors.brandPrimary }]}>Admin Workstation</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.brandPrimary} />
              </Pressable>
            )}
            <Pressable testID="menu-referrals" style={[styles.item, { borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }]} onPress={() => go("/referrals")}>
              <MaterialCommunityIcons name="gift-outline" size={20} color={colors.brandPrimary} />
              <Text style={[styles.itemText, { color: colors.brandPrimary }]}>Share & Earn $5</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.brandPrimary} />
            </Pressable>
            <Pressable testID="menu-paint-studio" style={[styles.item, { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }]} onPress={() => go("/paint-studio")}>
              <MaterialCommunityIcons name="format-paint" size={20} color={colors.brandPrimary} />
              <Text style={styles.itemText}>Paint Studio</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
            <Pressable testID="menu-calculators" style={[styles.item, { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }]} onPress={() => go("/calculators")}>
              <MaterialCommunityIcons name="calculator-variant-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.itemText}>DIY Calculators</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
            <Text style={styles.section}>{t("menu.language").toUpperCase()}</Text>
            <Pressable testID="menu-blog" style={styles.item} onPress={() => go("/blog")}>
              <MaterialCommunityIcons name="book-open-page-variant" size={20} color={colors.brandPrimary} />
              <Text style={styles.itemText}>DIY Guide Library</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
            <Pressable testID="menu-language" style={styles.item} onPress={() => go("/settings/language")}>
              <MaterialCommunityIcons name="translate" size={20} color={colors.brandPrimary} />
              <Text style={styles.itemText}>{metaFor(i18n.language).native}</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>

            <Text style={styles.section}>{t("menu.helpSupport")}</Text>
            {HELP.map((it) => (
              <Pressable key={it.route} testID={`menu-${it.route}`} style={styles.item} onPress={() => go(it.route)}>
                <MaterialCommunityIcons name={it.icon as any} size={20} color={colors.brandPrimary} />
                <Text style={styles.itemText}>{it.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}

            <Text style={styles.section}>{t("menu.legal")}</Text>
            {LEGAL.map((it) => (
              <Pressable key={it.route} testID={`menu-${it.route}`} style={styles.item} onPress={() => go(it.route)}>
                <MaterialCommunityIcons name={it.icon as any} size={20} color={colors.brandPrimary} />
                <Text style={styles.itemText}>{it.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}

            <View style={styles.footer}>
              <Text style={styles.followLabel}>{t("menu.follow")}</Text>
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
