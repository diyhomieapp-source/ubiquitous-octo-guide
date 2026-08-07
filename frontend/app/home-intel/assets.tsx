import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Asset = { id: string; name: string; category: string; brand?: string; model_number?: string; status: string; photo_base64?: string; room_name?: string };

export default function AssetsScreen() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ assets: Asset[] }>("/hi/assets");
      setAssets(d.assets);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byRoom: Record<string, Asset[]> = {};
  assets.forEach((a) => { const k = a.room_name || "Unassigned"; (byRoom[k] = byRoom[k] || []).push(a); });
  const rooms = Object.keys(byRoom).sort();

  return (
    <View style={styles.root}>
      <ScreenHeader title="My Home Assets" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Pressable testID="hi-add-asset" style={styles.addBtn} onPress={() => router.push("/home-intel/asset-add")}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add Asset</Text>
        </Pressable>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          assets.length === 0 ? (
            <Text style={styles.empty}>No assets yet. Add appliances, HVAC, water heater, etc., so guidance can be tailored to your exact equipment.</Text>
          ) : rooms.map((room) => (
            <View key={room}>
              <Text style={styles.room}>{room}</Text>
              {byRoom[room].map((a) => (
                <Pressable key={a.id} testID={`hi-asset-card-${a.id}`} style={styles.card} onPress={() => router.push(`/home-intel/asset/${a.id}`)}>
                  {a.photo_base64
                    ? <Image source={{ uri: `data:image/jpeg;base64,${a.photo_base64}` }} style={styles.photo} contentFit="cover" />
                    : <View style={[styles.photo, styles.photoPlaceholder]}><MaterialCommunityIcons name="cube-outline" size={24} color={colors.onSurfaceTertiary} /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{a.name}</Text>
                    <Text style={styles.meta}>{a.category}{a.brand ? ` · ${a.brand}` : ""}{a.model_number ? ` ${a.model_number}` : ""}</Text>
                    <View style={styles.statusPill}><Text style={styles.statusText}>{a.status || "ok"}</Text></View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  addText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.lg },
  room: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  photo: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  statusPill: { alignSelf: "flex-start", backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.xs },
  statusText: { color: colors.onBrandTertiary, fontFamily: font.medium, fontSize: 10, textTransform: "capitalize" },
});
