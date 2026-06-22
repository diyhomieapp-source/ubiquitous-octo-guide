import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { api } from "@/src/api";

type Post = { slug: string; title: string; product?: string; category?: string; excerpt?: string; views?: number; tags?: string[] };

export default function BlogFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (category?: string | null, query?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.append("category", category);
      if (query) params.append("q", query);
      const res = await api<{ posts: Post[]; categories: string[] }>(`/blog?${params.toString()}`);
      setPosts(res.posts || []);
      setCats(res.categories || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(cat, q); }, [load, cat, q]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="DIY Guide Library" />
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="blog-search"
          style={styles.search}
          placeholder="Search guides, products, models…"
          placeholderTextColor={colors.onSurfaceTertiary}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => load(cat, q)}
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        ListHeaderComponent={
          cats.length > 0 ? (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={["All", ...cats]}
              keyExtractor={(c) => c}
              style={{ marginBottom: spacing.md }}
              renderItem={({ item }) => {
                const on = (item === "All" && !cat) || item === cat;
                return (
                  <Pressable testID={`blog-cat-${item}`} style={[styles.chip, on && styles.chipOn]} onPress={() => setCat(item === "All" ? null : item)}>
                    <Text style={[styles.chipText, on && { color: colors.onBrandPrimary }]}>{item}</Text>
                  </Pressable>
                );
              }}
            />
          ) : null
        }
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="book-open-page-variant-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No guides yet — they appear here automatically as plans get built.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable testID={`blog-post-${item.slug}`} style={styles.card} onPress={() => router.push(`/blog/${item.slug}`)}>
            {!!item.category && <Text style={styles.cardCat}>{item.category.toUpperCase()}</Text>}
            <Text style={styles.cardTitle}>{item.title}</Text>
            {!!item.excerpt && <Text style={styles.cardExcerpt} numberOfLines={2}>{item.excerpt}</Text>}
            <View style={styles.cardFoot}>
              {!!item.product && <Text style={styles.cardProduct}>{item.product}</Text>}
              <Text style={styles.cardViews}>{item.views || 0} views</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, margin: spacing.lg, marginBottom: 0, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md },
  search: { flex: 1, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginRight: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  cardCat: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginBottom: spacing.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.xs },
  cardExcerpt: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  cardProduct: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  cardViews: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  empty: { alignItems: "center", gap: spacing.md, marginTop: 60, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
});
