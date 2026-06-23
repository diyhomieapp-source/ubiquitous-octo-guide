import { View, Text, StyleSheet, ScrollView, Pressable, Linking, useWindowDimensions, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Logo } from "@/src/components/Logo";
import { DiyBackdrop } from "@/src/components/DiyBackdrop";

// Paste real store URLs here once the apps are published — buttons go live instantly.
const APP_STORE_URL = "";
const PLAY_STORE_URL = "";

const FEATURES = [
  { icon: "robot-happy-outline", title: "AI step-by-step guides", desc: "Tell Homie any repair or project and get an expert, photo-rich plan in seconds." },
  { icon: "toolbox-outline", title: "Built around your setup", desc: "Tailored to the exact tools you own, your skill level and your budget." },
  { icon: "map-marker-check-outline", title: "Local-code aware", desc: "Guidance that respects your city's permit, plumbing and electrical codes." },
  { icon: "format-paint", title: "Paint & finish visualizer", desc: "See new colors on your actual walls before you buy a single can." },
  { icon: "calculator-variant-outline", title: "DIY calculators", desc: "Paint, tile, concrete, flooring — know exactly what to buy, no waste." },
  { icon: "calendar-clock", title: "Maintenance scheduler", desc: "Never forget a filter, gutter or tune-up. Your home, on autopilot." },
];

const STEPS = [
  { n: "1", title: "Describe your project", desc: "“How do I replace my kitchen faucet?” — type it or say it." },
  { n: "2", title: "Get a tailored plan", desc: "Step-by-step instructions, tools, materials, costs and code tips." },
  { n: "3", title: "Build with confidence", desc: "Homie answers questions live as you work — like a pro on call." },
];

const QUOTES = [
  { q: "I replaced my own garbage disposal in an afternoon. Saved a $250 service call.", a: "Marcus · first-time DIYer" },
  { q: "It knew the permit rules for my city. That alone is worth it.", a: "Dana · homeowner" },
  { q: "The shopping list with store links saved me three trips to the hardware store.", a: "Priya · weekend renovator" },
];

export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const start = () => { Haptics.selectionAsync(); router.push("/onboarding"); };
  const signIn = () => router.push("/auth?mode=login");

  return (
    <View style={styles.root}>
      <DiyBackdrop />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {/* nav */}
        <View style={[styles.nav, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.navInner}>
            <Logo width={wide ? 132 : 104} />
            <View style={styles.navRight}>
              {wide && (
                <Pressable testID="landing-signin" onPress={signIn} style={styles.navLink}>
                  <Text style={styles.navLinkText}>Sign in</Text>
                </Pressable>
              )}
              <Pressable testID="landing-nav-start" onPress={start} style={styles.navCta}>
                <Text style={styles.navCtaText}>Start free</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* hero */}
        <View style={[styles.section, styles.hero, wide && styles.heroWide]}>
          <View style={[styles.heroText, wide && { flex: 1, paddingRight: spacing["2xl"] }]}>
            <View style={styles.eyebrow}>
              <MaterialCommunityIcons name="hammer-wrench" size={14} color={colors.brandPrimary} />
              <Text style={styles.eyebrowText}>YOUR AI MASTER CONTRACTOR</Text>
            </View>
            <Text style={[styles.h1, wide && { fontSize: 60, lineHeight: 60 }]}>
              Fix it. Build it.{"\n"}Do it right.
            </Text>
            <Text style={styles.heroSub}>
              Like having a trusted contractor on call 24/7, DIYhomie gives you personalized, step-by-step
              guidance for every repair, maintenance and home-improvement project — so you tackle each job with confidence.
            </Text>
            <View style={styles.heroCtas}>
              <Pressable testID="landing-hero-start" onPress={start} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Start your first project free</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
            <Text style={styles.trust}>Free to start · No credit card · Cancel anytime</Text>
            <View style={{ marginTop: spacing.lg }}>
              <StoreBadges />
            </View>
          </View>

          <View style={[styles.heroVisual, wide && { flex: 1 }]}>
            <PhonePreview />
          </View>
        </View>

        {/* value strip */}
        <View style={[styles.section, styles.strip, wide && { flexDirection: "row" }]}>
          {[
            { icon: "shield-check-outline", t: "50-state code aware" },
            { icon: "image-multiple-outline", t: "Photo-guided steps" },
            { icon: "cart-outline", t: "Shop 7 major retailers" },
            { icon: "account-voice", t: "Ask Homie anything, live" },
          ].map((s) => (
            <View key={s.t} style={styles.stripItem}>
              <MaterialCommunityIcons name={s.icon as any} size={20} color={colors.brandPrimary} />
              <Text style={styles.stripText}>{s.t}</Text>
            </View>
          ))}
        </View>

        {/* how it works */}
        <View style={styles.section}>
          <Text style={styles.kicker}>HOW IT WORKS</Text>
          <Text style={styles.h2}>From “I have no idea” to done — in 3 steps</Text>
          <View style={[styles.steps, wide && { flexDirection: "row" }]}>
            {STEPS.map((s) => (
              <View key={s.n} style={[styles.stepCard, wide && { flex: 1 }]}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{s.n}</Text></View>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepDesc}>{s.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* features */}
        <View style={styles.section}>
          <Text style={styles.kicker}>EVERYTHING YOU NEED</Text>
          <Text style={styles.h2}>One app for every project in your home</Text>
          <View style={styles.featGrid}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[styles.featCard, wide ? { width: "31.5%" } : { width: "100%" }]}>
                <View style={styles.featIcon}><MaterialCommunityIcons name={f.icon as any} size={24} color={colors.brandPrimary} /></View>
                <Text style={styles.featTitle}>{f.title}</Text>
                <Text style={styles.featDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* testimonials */}
        <View style={styles.section}>
          <Text style={styles.kicker}>HOMEOWNERS LOVE IT</Text>
          <Text style={styles.h2}>Real projects. Real savings.</Text>
          <View style={[styles.quotes, wide && { flexDirection: "row" }]}>
            {QUOTES.map((q) => (
              <View key={q.a} style={[styles.quoteCard, wide && { flex: 1 }]}>
                <View style={styles.stars}>
                  {[0, 1, 2, 3, 4].map((i) => <MaterialCommunityIcons key={i} name="star" size={15} color={colors.brandPrimary} />)}
                </View>
                <Text style={styles.quoteText}>“{q.q}”</Text>
                <Text style={styles.quoteAuthor}>{q.a}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* final CTA */}
        <View style={styles.section}>
          <View style={styles.finalCta}>
            <Text style={styles.finalTitle}>Your next project starts now.</Text>
            <Text style={styles.finalSub}>Join homeowners saving thousands by doing it themselves — the right way.</Text>
            <Pressable testID="landing-final-start" onPress={start} style={[styles.primaryBtn, { marginTop: spacing.lg }]}>
              <Text style={styles.primaryBtnText}>Get started free</Text>
              <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
            </Pressable>
            <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
              <StoreBadges center />
            </View>
          </View>
        </View>

        {/* footer */}
        <View style={[styles.section, styles.footer]}>
          <Logo width={120} />
          <View style={styles.footerLinks}>
            <Pressable onPress={() => router.push("/blog")}><Text style={styles.footerLink}>Blog</Text></Pressable>
            <Pressable onPress={signIn}><Text style={styles.footerLink}>Sign in</Text></Pressable>
            <Pressable onPress={start}><Text style={styles.footerLink}>Get the app</Text></Pressable>
          </View>
          <Text style={styles.copyright}>© {new Date().getFullYear()} DIYhomie. Your home, handled.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StoreBadges({ center }: { center?: boolean }) {
  const router = useRouter();
  const tap = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
    else router.push("/onboarding"); // not published yet → start on web
  };
  return (
    <View style={{ alignItems: center ? "center" : "flex-start" }}>
      <View style={styles.badges}>
        <Pressable testID="badge-appstore" style={styles.badge} onPress={() => tap(APP_STORE_URL)}>
          <MaterialCommunityIcons name="apple" size={26} color="#fff" />
          <View>
            <Text style={styles.badgeSmall}>Download on the</Text>
            <Text style={styles.badgeBig}>App Store</Text>
          </View>
        </Pressable>
        <Pressable testID="badge-playstore" style={styles.badge} onPress={() => tap(PLAY_STORE_URL)}>
          <MaterialCommunityIcons name="google-play" size={22} color="#fff" />
          <View>
            <Text style={styles.badgeSmall}>GET IT ON</Text>
            <Text style={styles.badgeBig}>Google Play</Text>
          </View>
        </Pressable>
      </View>
      <Text style={[styles.badgeNote, center && { textAlign: "center" }]}>iOS & Android coming soon — start free on the web today.</Text>
    </View>
  );
}

function PhonePreview() {
  return (
    <View style={styles.phone}>
      <View style={styles.phoneNotch} />
      <View style={styles.phoneScreen}>
        <Text style={styles.pvKicker}>STEP 3 OF 7</Text>
        <Text style={styles.pvTitle}>Replace the wax ring</Text>
        <View style={styles.pvBar}><View style={styles.pvBarFill} /></View>
        <View style={styles.pvImg}>
          <MaterialCommunityIcons name="toilet" size={46} color={colors.brandPrimary} />
        </View>
        <View style={styles.pvRow}>
          <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
          <Text style={styles.pvRowText}>Set the new wax ring on the flange</Text>
        </View>
        <View style={styles.pvRow}>
          <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.pvRowText}>Lower the bowl & press evenly</Text>
        </View>
        <View style={styles.pvAsk}>
          <MaterialCommunityIcons name="message-text-outline" size={14} color={colors.brandPrimary} />
          <Text style={styles.pvAskText}>Ask Homie a question…</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0E0E0E" },
  nav: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  navInner: { width: "100%", maxWidth: 1100, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  navLink: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  navLinkText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  navCta: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  navCtaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },

  section: { width: "100%", maxWidth: 1100, alignSelf: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing["2xl"] },
  hero: { alignItems: "flex-start" },
  heroWide: { flexDirection: "row", alignItems: "center", paddingVertical: spacing["3xl"] },
  heroText: { width: "100%" },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,106,0,0.12)", alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderColor: "rgba(255,106,0,0.4)", borderWidth: 1 },
  eyebrowText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, letterSpacing: 1 },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 46, lineHeight: 46, marginTop: spacing.lg },
  heroSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 26, marginTop: spacing.lg, maxWidth: 540 },
  heroCtas: { marginTop: spacing.xl },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderRadius: radius.md, alignSelf: "flex-start" },
  primaryBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.3 },
  trust: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md },

  heroVisual: { width: "100%", alignItems: "center", marginTop: spacing["2xl"] },

  strip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, justifyContent: "space-between", borderTopColor: colors.border, borderBottomColor: colors.border, borderTopWidth: 1, borderBottomWidth: 1 },
  stripItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stripText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },

  kicker: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 2 },
  h2: { color: colors.onSurface, fontFamily: font.display, fontSize: 34, lineHeight: 36, marginTop: spacing.sm, marginBottom: spacing.xl, maxWidth: 620 },

  steps: { gap: spacing.lg },
  stepCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl },
  stepNum: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,106,0,0.14)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  stepNumText: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 24 },
  stepTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  stepDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.xs },

  featGrid: { flexDirection: "row", flexWrap: "wrap", gap: "2.75%", rowGap: spacing.lg },
  featCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl },
  featIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: "rgba(255,106,0,0.12)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  featTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  featDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginTop: spacing.xs },

  quotes: { gap: spacing.lg },
  quoteCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl },
  stars: { flexDirection: "row", gap: 2, marginBottom: spacing.sm },
  quoteText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, lineHeight: 25 },
  quoteAuthor: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md },

  finalCta: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 2, borderRadius: radius.xl, padding: spacing["2xl"], alignItems: "center" },
  finalTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 38, lineHeight: 40, textAlign: "center" },
  finalSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", marginTop: spacing.sm, maxWidth: 480 },

  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#000", borderColor: "#333", borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minWidth: 150 },
  badgeSmall: { color: "#bbb", fontFamily: font.medium, fontSize: 10, letterSpacing: 0.5 },
  badgeBig: { color: "#fff", fontFamily: font.bold, fontSize: type.lg, marginTop: -1 },
  badgeNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },

  phone: { width: 280, height: 560, backgroundColor: "#1A1A1A", borderRadius: 40, borderColor: "#2c2c2c", borderWidth: 8, padding: spacing.md, overflow: "hidden", shadowColor: colors.brandPrimary, shadowOpacity: 0.25, shadowRadius: 40, shadowOffset: { width: 0, height: 12 } },
  phoneNotch: { position: "absolute", top: 8, alignSelf: "center", width: 110, height: 22, borderRadius: 12, backgroundColor: "#2c2c2c", zIndex: 2 },
  phoneScreen: { flex: 1, backgroundColor: colors.surface, borderRadius: 28, padding: spacing.lg, paddingTop: spacing["2xl"] },
  pvKicker: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  pvTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, marginTop: 4 },
  pvBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, marginTop: spacing.md, overflow: "hidden" },
  pvBarFill: { width: "43%", height: "100%", backgroundColor: colors.brandPrimary },
  pvImg: { height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  pvRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  pvRowText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, flex: 1 },
  pvAsk: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: "auto", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderColor: colors.border, borderWidth: 1 },
  pvAskText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },

  footer: { borderTopColor: colors.border, borderTopWidth: 1, alignItems: "center", gap: spacing.md },
  footerLinks: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
  footerLink: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  copyright: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
});
