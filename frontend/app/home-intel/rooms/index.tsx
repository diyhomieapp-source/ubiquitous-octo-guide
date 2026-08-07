import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Room = { id: string; name: string; room_type?: string; floor_id?: string; cover_photo_base64?: string; status?: string };
type Floor = { id: string; name: string };

export default function PropertyHome() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [prop, setProp] = useState<{ name?: string; address?: string }>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ property: any; rooms: Room[]; floors: Floor[]; room_count: number }>("/hi/rooms/map");
      setRooms(d.rooms); setFloors(d.floors); setProp(d.property || {});
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="My Property" right={
        <Pressable testID="rooms-map-btn" onPress={() => router.push("/home-intel/rooms/map")}>
          <MaterialCommunityIcons name="map-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.propName}>{prop.name || "My Home"}</Text>
        {!!prop.address && <Text style={styles.addr}>{prop.address}</Text>}
        <Text style={styles.progress}>{rooms.length} room{rooms.length === 1 ? "" : "s"} documented{floors.length ? ` · ${floors.length} floor${floors.length === 1 ? "" : "s"}` : ""}</Text>

        <Pressable testID="rooms-map-a-room" style={styles.primary} onPress={() => router.push("/home-intel/rooms/capture")}>
          <MaterialCommunityIcons name="floor-plan" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Map a Room</Text>
        </Pressable>
        <Pressable testID="rooms-walkthrough" style={styles.secondary} onPress={() => router.push("/home-intel/rooms/walkthrough")}>
          <MaterialCommunityIcons name="walk" size={20} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>Continue Home Walkthrough</Text>
        </Pressable>

        <Text style={styles.section}>Your rooms</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} /> :
          rooms.length === 0 ? <Text style={styles.empty}>No rooms yet. Tap “Map a Room” to start — one room at a time.</Text> :
          <View style={styles.grid}>
            {rooms.map((rm) => (
              <Pressable key={rm.id} testID={`room-card-${rm.id}`} style={styles.card} onPress={() => router.push(`/home-intel/rooms/${rm.id}`)}>
                {rm.cover_photo_base64
                  ? <Image source={{ uri: `data:image/jpeg;base64,${rm.cover_photo_base64}` }} style={styles.cover} contentFit="cover" />
                  : <View style={[styles.cover, styles.coverPlaceholder]}><MaterialCommunityIcons name="door" size={24} color={colors.onSurfaceTertiary} /></View>}
                <Text style={styles.roomName} numberOfLines={1}>{rm.name}</Text>
                <Text style={styles.roomType} numberOfLines={1}>{rm.room_type || "Room"}</Text>
              </Pressable>
            ))}
          </View>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  propName: { color: colors.onSurface, fontFamily: font.display, fontSize: type["3xl"] },
  addr: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 2 },
  progress: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm, marginBottom: spacing.lg },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: "47%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, overflow: "hidden", padding: spacing.sm },
  cover: { width: "100%", height: 90, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  roomName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.xs },
  roomType: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
