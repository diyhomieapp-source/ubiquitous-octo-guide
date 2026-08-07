import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Room = { id: string; name: string; room_type?: string; floor_id?: string };
type Floor = { id: string; name: string };
type Conn = { room_id: string; connected_room_id: string; connection_type: string };

export default function RoomMap() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ rooms: Room[]; floors: Floor[]; connections: Conn[] }>("/hi/rooms/map");
      setRooms(d.rooms); setFloors(d.floors); setConns(d.connections);
      setActiveFloor((prev) => prev || (d.floors[0]?.id ?? null));
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nameOf = (id: string) => rooms.find((r) => r.id === id)?.name || "Unknown";
  const floorRooms = rooms.filter((r) => !activeFloor || r.floor_id === activeFloor);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Room Map" />
      <Text style={styles.disclaimer}>A property organization map — not an architectural drawing.</Text>
      {floors.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorTabs}>
          {floors.map((f) => (
            <Pressable key={f.id} testID={`map-floor-${f.id}`} style={[styles.floorTab, activeFloor === f.id && styles.floorTabOn]} onPress={() => setActiveFloor(f.id)}>
              <Text style={[styles.floorTabText, activeFloor === f.id && styles.floorTabTextOn]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          {floorRooms.length === 0 ? <Text style={styles.empty}>No rooms on this floor yet.</Text> :
            floorRooms.map((r) => {
              const linked = conns.filter((c) => c.room_id === r.id);
              return (
                <Pressable key={r.id} testID={`map-node-${r.id}`} style={styles.node} onPress={() => router.push(`/home-intel/rooms/${r.id}`)}>
                  <View style={styles.nodeHead}>
                    <MaterialCommunityIcons name="door" size={20} color={colors.brandPrimary} />
                    <Text style={styles.nodeName}>{r.name}</Text>
                    <Text style={styles.nodeType}>{r.room_type || "Room"}</Text>
                  </View>
                  {linked.length > 0 && (
                    <View style={styles.links}>
                      {linked.map((c, i) => (
                        <View key={i} style={styles.link}>
                          <MaterialCommunityIcons name="arrow-right-thin" size={16} color={colors.onSurfaceTertiary} />
                          <Text style={styles.linkText}>{nameOf(c.connected_room_id)} ({c.connection_type})</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
              );
            })}
        </ScrollView>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  floorTabs: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  floorTab: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  floorTabOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  floorTabText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  floorTabTextOn: { color: colors.brandPrimary },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  node: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  nodeHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nodeName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  nodeType: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  links: { marginTop: spacing.sm, paddingLeft: spacing.lg, gap: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
});
