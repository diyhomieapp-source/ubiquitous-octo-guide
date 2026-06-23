import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Link = { retailer: string; label: string; url: string };
type Item = { name: string; links: Link[] };
type Category = { key: string; label: string; items: Item[] };
type Widget = { title: string; disclosure: string; categories: Category[] };

export function AffiliateWidget({ slug }: { slug: string }) {
  const [widget, setWidget] = useState<Widget | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = await api<Widget>(`/blog/${slug}/materials`);
        if (alive && w?.categories?.length) setWidget(w);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [slug]);

  if (!widget) return null;

  const open = (url: string) => {
    Haptics.selectionAsync();
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="cart-outline" size={20} color={colors.brandPrimary} />
        <Text style={styles.title}>{widget.title}</Text>
      </View>
      <Text style={styles.sub}>Everything you need — pick your favorite store.</Text>

      {widget.categories.map((c) => (
        <View key={c.key} style={styles.group}>
          <Text style={styles.cat}>{c.label.toUpperCase()}</Text>
          {c.items.map((it, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.itemName}>{it.name}</Text>
              <View style={styles.btnRow}>
                {it.links.map((l) => {
                  const direct = l.retailer === "direct";
                  return (
                    <Pressable
                      key={l.retailer}
                      testID={`aff-${c.key}-${i}-${l.retailer}`}
                      style={[styles.btn, direct && styles.btnDirect]}
                      onPress={() => open(l.url)}
                    >
                      <Text style={[styles.btnText, direct && styles.btnTextDirect]}>{l.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ))}

      <Text style={styles.disc}>{widget.disclosure}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing["2xl"], padding: spacing.lg, borderColor: colors.brandPrimary, borderWidth: 2, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, marginBottom: spacing.md },
  group: { marginTop: spacing.md },
  cat: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, marginBottom: spacing.sm },
  item: { paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  itemName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.sm },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  btn: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  btnDirect: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  btnTextDirect: { color: colors.onBrandPrimary },
  disc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: spacing.lg },
});
