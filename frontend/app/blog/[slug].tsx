import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, Platform } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { api } from "@/src/api";

type Post = {
  slug: string; title: string; h1?: string; product?: string; category?: string; overview?: string;
  tools?: string[]; materials?: string[]; safety?: string[]; common_mistakes?: string[];
  steps?: { title: string; instruction: string }[]; views?: number;
};

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function BlogPost() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPost(await api<Post>(`/blog/${slug}`)); } catch {} finally { setLoading(false); }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onShare = async () => {
    if (!post) return;
    const url = `${BASE}/api/blog/${post.slug}/html`;
    const message = `${post.title} — free step-by-step DIY guide`;
    Haptics.selectionAsync();
    try {
      if (Platform.OS === "web") {
        const nav: any = typeof navigator !== "undefined" ? navigator : null;
        if (nav?.share) await nav.share({ title: post.title, text: message, url });
        else if (nav?.clipboard) { await nav.clipboard.writeText(url); if (typeof alert !== "undefined") alert("Link copied!"); }
      } else {
        await Share.share({ message: `${message} ${url}`, url });
      }
    } catch {}
  };

  const startProject = async () => {
    if (!post || starting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    const title = post.title.replace(/^how to /i, "").trim();
    try {
      const proj = await api<{ id: string }>("/projects", { method: "POST", body: { title } });
      router.push(`/project/${proj.id}?new=1`);
    } catch { router.push("/onboarding"); } finally { setStarting(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Guide" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} /></View>;
  if (!post) return <View style={styles.root}><ScreenHeader title="Guide" /><Text style={styles.missing}>This guide couldn't be found.</Text></View>;

  const tools = [...(post.tools || []), ...(post.materials || [])];

  return (
    <View style={styles.root}>
      <ScreenHeader title="DIY Guide" right={<Pressable testID="blog-share" onPress={onShare} hitSlop={8}><MaterialCommunityIcons name="share-variant" size={22} color={colors.onSurface} /></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {!!post.category && <Text style={styles.cat}>{post.category.toUpperCase()}{post.product ? ` · ${post.product}` : ""}</Text>}
        <Text style={styles.h1}>{post.h1 || post.title}</Text>
        {!!post.overview && <Text style={styles.lede}>{post.overview}</Text>}

        <Pressable testID="blog-share-btn" style={styles.shareBtn} onPress={onShare}>
          <MaterialCommunityIcons name="share-variant" size={18} color={colors.brandPrimary} />
          <Text style={styles.shareText}>Share this guide</Text>
        </Pressable>

        {tools.length > 0 && (
          <>
            <Text style={styles.h2}>What you'll need</Text>
            {tools.map((t, i) => <Text key={i} style={styles.li}>• {t}</Text>)}
          </>
        )}

        {(post.steps || []).length > 0 && (
          <>
            <Text style={styles.h2}>Step-by-step</Text>
            {post.steps!.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.snum}><Text style={styles.snumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stitle}>{s.title}</Text>
                  <Text style={styles.sinstr}>{s.instruction}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {(post.safety || []).length > 0 && (
          <View style={styles.safety}>
            <Text style={styles.h2safe}>Stay safe</Text>
            {post.safety!.map((s, i) => <Text key={i} style={styles.li}>• {s}</Text>)}
          </View>
        )}

        {(post.common_mistakes || []).length > 0 && (
          <>
            <Text style={styles.h2}>Common mistakes to avoid</Text>
            {post.common_mistakes!.map((s, i) => <Text key={i} style={styles.li}>• {s}</Text>)}
          </>
        )}

        <View style={styles.cta}>
          <Text style={styles.ctaTitle}>Want this built for YOUR exact setup?</Text>
          <Text style={styles.ctaSub}>Get it personalized with step photos, your tools, local code tips, and Homie answering questions live as you work.</Text>
          <Pressable testID="blog-start-project" style={styles.ctaBtn} onPress={startProject} disabled={starting}>
            {starting ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Text style={styles.ctaBtnText}>Start this with Homie</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  missing: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", marginTop: 60 },
  cat: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, marginBottom: spacing.xs },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 30, lineHeight: 34 },
  lede: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 24, marginTop: spacing.md },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  shareText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  h2: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, marginTop: spacing.xl, marginBottom: spacing.sm },
  h2safe: { color: colors.error, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginBottom: spacing.xs },
  step: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  snum: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  snumText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  stitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: 2 },
  sinstr: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  safety: { backgroundColor: colors.surfaceSecondary, borderColor: colors.error, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg },
  cta: { marginTop: spacing["2xl"], padding: spacing.xl, borderColor: colors.brandPrimary, borderWidth: 2, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  ctaTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, marginBottom: spacing.sm },
  ctaSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.lg },
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md },
  ctaBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
});
