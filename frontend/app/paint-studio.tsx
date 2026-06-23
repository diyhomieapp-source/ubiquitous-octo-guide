import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image,
  TextInput, Platform, Linking, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Feature = "wall" | "cabinet" | "flooring" | "exterior";

const FEATURES: { key: Feature; label: string; icon: string }[] = [
  { key: "wall", label: "Walls", icon: "format-paint" },
  { key: "exterior", label: "Exterior", icon: "home-outline" },
  { key: "cabinet", label: "Cabinets", icon: "fridge-outline" },
  { key: "flooring", label: "Flooring", icon: "view-grid-outline" },
];

const ROOM_TYPES = ["livingroom", "bedroom", "kitchen", "bathroom", "diningroom", "office"];

const PALETTES: { brand: string; colors: { name: string; hex: string }[] }[] = [
  { brand: "Sherwin-Williams", colors: [
    { name: "Agreeable Gray", hex: "#D1C7B8" }, { name: "Naval", hex: "#2F3A4A" },
    { name: "Sea Salt", hex: "#CDD5CA" }, { name: "Tricorn Black", hex: "#2B2B2B" },
    { name: "Alabaster", hex: "#EDEAE0" }, { name: "Evergreen Fog", hex: "#95978A" },
  ] },
  { brand: "Benjamin Moore", colors: [
    { name: "Hale Navy", hex: "#434B54" }, { name: "Revere Pewter", hex: "#CCC3B4" },
    { name: "Chantilly Lace", hex: "#F4F5F0" }, { name: "Hague Blue", hex: "#34434C" },
    { name: "Simply White", hex: "#EFEEE4" }, { name: "Kendall Charcoal", hex: "#6A685E" },
  ] },
  { brand: "Behr", colors: [
    { name: "Blank Canvas", hex: "#E8E2D5" }, { name: "Cracked Pepper", hex: "#37383A" },
    { name: "Back to Nature", hex: "#A4AC86" }, { name: "Dragon Fruit", hex: "#C24E6B" },
    { name: "Polar Bear", hex: "#F0EFE9" }, { name: "Dark Everglade", hex: "#3A4A42" },
  ] },
];

const FLOORING_OPTIONS = [
  { name: "Dark mahogany hardwood", hex: "#5A3A28" },
  { name: "Natural light oak", hex: "#C7A877" },
  { name: "Gray wash laminate", hex: "#9B958C" },
  { name: "Warm walnut planks", hex: "#6B4A33" },
  { name: "White marble tile", hex: "#E8E6E1" },
  { name: "Slate gray tile", hex: "#5B5F63" },
];

const SUPPLIES: Record<Feature, string[]> = {
  wall: ["Interior paint (1-2 gal)", "Primer", '2.5" angled brush', "Roller + tray", "Painter's tape", "Drop cloth"],
  exterior: ["Exterior paint", "Paint sprayer", "Pressure washer", "Primer", "Painter's tape", "Ladder"],
  cabinet: ["Cabinet paint/enamel", "Bonding primer", "Foam rollers", "Sanding block", "Degreaser", "Painter's tape"],
  flooring: ["Flooring planks/tile", "Underlayment", "Spacers", "Tapping block", "Utility knife", "Adhesive/grout"],
};

export default function PaintStudio() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [feature, setFeature] = useState<Feature>("wall");
  const [roomType, setRoomType] = useState("livingroom");
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [color, setColor] = useState<{ name: string; hex: string } | null>(null);
  const [customHex, setCustomHex] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [loading, setLoading] = useState(false);

  const usesColor = feature === "wall" || feature === "cabinet" || feature === "exterior";
  const swatches = feature === "flooring" ? FLOORING_OPTIONS : null;

  const ensurePerm = async (kind: "camera" | "library") => {
    const get = kind === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
    const ask = kind === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
    let perm = await get();
    if (perm.granted) return true;
    if (perm.canAskAgain) perm = await ask();
    if (perm.granted) return true;
    Alert.alert(
      kind === "camera" ? "Camera access needed" : "Photo access needed",
      `Allow access so you can ${kind === "camera" ? "snap" : "choose"} a room photo to repaint.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
    );
    return false;
  };

  const handlePicked = (res: ImagePicker.ImagePickerResult) => {
    if (!res.canceled && res.assets?.[0]?.base64) {
      setImageB64(res.assets[0].base64);
      setImagePreview(res.assets[0].uri);
      setResult(null);
    }
  };

  const pickFromLibrary = async () => {
    if (!(await ensurePerm("library"))) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, base64: true, quality: 0.7 });
    handlePicked(res);
  };
  const takePhoto = async () => {
    if (Platform.OS === "web") return pickFromLibrary();
    if (!(await ensurePerm("camera"))) return;
    const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, base64: true, quality: 0.7 });
    handlePicked(res);
  };

  const render = useCallback(async () => {
    if (!imageB64) { Alert.alert("Add a photo", "Upload or snap a room photo first."); return; }
    if (usesColor && !color && !(customHex.match(/^#?[0-9a-fA-F]{6}$/))) { Alert.alert("Pick a color", "Choose a paint color or enter a hex code."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResult(null);
    const hex = color?.hex || (customHex.startsWith("#") ? customHex : `#${customHex}`);
    try {
      const body: any = { image_base64: imageB64, feature_type: feature, room_type: roomType };
      if (usesColor) { body.color_hex = hex; body.color_name = color?.name; }
      else { body.color_name = color?.name; body.color_hex = color?.hex; }
      const res = await api<{ result_url: string; credits: number }>("/visualize", { method: "POST", body });
      setResult(res.result_url);
      setShowBefore(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh?.();
    } catch (e: any) {
      if (e?.status === 402) {
        Alert.alert("Out of credits", "Upgrade to keep visualizing.", [{ text: "Later", style: "cancel" }, { text: "Upgrade", onPress: () => router.push("/paywall") }]);
      } else {
        Alert.alert("Couldn't render", e?.message || "Try a clearer, well-lit room photo.");
      }
    } finally { setLoading(false); }
  }, [imageB64, color, customHex, feature, roomType, usesColor, refresh, router]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Paint Studio" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Upload a photo and see it transformed — instantly visualize new colors and finishes before you buy a drop of paint.</Text>

        {/* feature selector */}
        <View style={styles.featRow}>
          {FEATURES.map((f) => (
            <Pressable key={f.key} testID={`feat-${f.key}`} style={[styles.featChip, feature === f.key && styles.featChipOn]} onPress={() => { setFeature(f.key); setColor(null); setResult(null); }}>
              <MaterialCommunityIcons name={f.icon as any} size={20} color={feature === f.key ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.featText, feature === f.key && { color: colors.onBrandPrimary }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* step 1: photo */}
        <Text style={styles.step}>1 · YOUR PHOTO</Text>
        {imagePreview || result ? (
          <View>
            <Image source={{ uri: (result && !showBefore) ? result : imagePreview! }} style={styles.photo} resizeMode="cover" />
            {result && (
              <Pressable testID="compare-toggle" style={styles.compareBtn} onPressIn={() => setShowBefore(true)} onPressOut={() => setShowBefore(false)}>
                <MaterialCommunityIcons name="eye-outline" size={16} color={colors.onSurface} />
                <Text style={styles.compareText}>{showBefore ? "BEFORE" : "HOLD TO SEE BEFORE"}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.uploadBox}>
            <MaterialCommunityIcons name="image-plus" size={36} color={colors.onSurfaceTertiary} />
            <Text style={styles.uploadHint}>Add a clear, well-lit photo</Text>
          </View>
        )}
        <View style={styles.pickRow}>
          <Pressable testID="pick-gallery" style={styles.pickBtn} onPress={pickFromLibrary}>
            <MaterialCommunityIcons name="image-multiple-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.pickText}>Gallery</Text>
          </Pressable>
          <Pressable testID="pick-camera" style={styles.pickBtn} onPress={takePhoto}>
            <MaterialCommunityIcons name="camera-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.pickText}>Camera</Text>
          </Pressable>
        </View>

        {/* room type (wall) */}
        {feature === "wall" && (
          <>
            <Text style={styles.step}>ROOM TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              {ROOM_TYPES.map((r) => (
                <Pressable key={r} onPress={() => setRoomType(r)} style={[styles.roomChip, roomType === r && styles.roomChipOn]}>
                  <Text style={[styles.roomText, roomType === r && { color: colors.onBrandPrimary }]}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* step 2: color / finish */}
        <Text style={styles.step}>2 · {feature === "flooring" ? "CHOOSE A FINISH" : "CHOOSE A COLOR"}</Text>
        {swatches ? (
          <View style={styles.swatchGrid}>
            {swatches.map((c) => (
              <Pressable key={c.name} testID={`finish-${c.hex}`} style={[styles.swatchCard, color?.name === c.name && styles.swatchOn]} onPress={() => { setColor(c); setCustomHex(""); }}>
                <View style={[styles.swatch, { backgroundColor: c.hex }]} />
                <Text style={styles.swatchName} numberOfLines={2}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            {PALETTES.map((p) => (
              <View key={p.brand} style={{ marginBottom: spacing.md }}>
                <Text style={styles.brand}>{p.brand}</Text>
                <View style={styles.colorRow}>
                  {p.colors.map((c) => (
                    <Pressable key={c.hex} testID={`color-${c.hex}`} onPress={() => { setColor(c); setCustomHex(""); }} style={styles.colorWrap}>
                      <View style={[styles.dot, { backgroundColor: c.hex }, color?.hex === c.hex && styles.dotOn]} />
                      <Text style={styles.dotName} numberOfLines={1}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.hexRow}>
              <View style={[styles.hexPreview, { backgroundColor: (customHex.match(/^#?[0-9a-fA-F]{6}$/) ? (customHex.startsWith("#") ? customHex : `#${customHex}`) : colors.surfaceTertiary) }]} />
              <TextInput testID="hex-input" style={styles.hexInput} placeholder="Custom hex e.g. #3A5A78" placeholderTextColor={colors.onSurfaceTertiary} value={customHex} onChangeText={(t) => { setCustomHex(t); setColor(null); }} autoCapitalize="characters" />
            </View>
          </>
        )}

        {/* render */}
        <Pressable testID="render-btn" style={[styles.renderBtn, loading && { opacity: 0.7 }]} onPress={render} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <MaterialCommunityIcons name="auto-fix" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.renderText}>{result ? "RE-RENDER" : "VISUALIZE IT"}</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.creditNote}>Powered by Decor8 AI · {user?.credits ?? 0} credits left</Text>

        {/* shopping list (affiliate-ready) */}
        {result && (
          <View style={styles.shopCard}>
            <View style={styles.shopHead}>
              <MaterialCommunityIcons name="cart-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.shopTitle}>EVERYTHING YOU'LL NEED</Text>
            </View>
            {SUPPLIES[feature].map((s) => (
              <View key={s} style={styles.shopItem}>
                <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={14} color={colors.onSurfaceTertiary} />
                <Text style={styles.shopItemText}>{s}</Text>
              </View>
            ))}
            <View style={styles.shopSoon}>
              <MaterialCommunityIcons name="store-outline" size={15} color={colors.onSurfaceTertiary} />
              <Text style={styles.shopSoonText}>Shop at Home Depot & Lowe's — coming soon</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.lg },
  featRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  featChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexGrow: 1, justifyContent: "center" },
  featChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  featText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  step: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm, marginTop: spacing.sm },
  photo: { width: "100%", height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compareBtn: { position: "absolute", bottom: spacing.sm, right: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  compareText: { color: "#fff", fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  uploadBox: { height: 200, borderRadius: radius.md, borderColor: colors.borderStrong, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary },
  uploadHint: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  pickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.md },
  pickBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  pickText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  roomChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, marginRight: spacing.sm },
  roomChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roomText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  brand: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  colorWrap: { alignItems: "center", width: 78 },
  dot: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border },
  dotOn: { borderColor: colors.brandPrimary, borderWidth: 3 },
  dotName: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, textAlign: "center", marginTop: 3 },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatchCard: { width: "31%", flexGrow: 1, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, padding: spacing.sm, backgroundColor: colors.surfaceSecondary },
  swatchOn: { borderColor: colors.brandPrimary, borderWidth: 2 },
  swatch: { width: "100%", height: 48, borderRadius: radius.sm, marginBottom: 4 },
  swatchName: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 11 },
  hexRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  hexPreview: { width: 40, height: 40, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1 },
  hexInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, outlineStyle: "none" } as any,
  renderBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl },
  renderText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  creditNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.sm },
  shopCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginTop: spacing.xl },
  shopHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  shopTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  shopItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  shopItemText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  shopSoon: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  shopSoonText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
