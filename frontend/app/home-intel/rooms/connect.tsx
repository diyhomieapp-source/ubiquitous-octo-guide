import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CONNECTION_TYPES = ["Doorway", "Open Passage", "Stairs", "Exterior Access", "Unknown"];
type Room = { id: string; name: string; room_type?: string };

export default function ConnectRooms() {
  const router = useRouter();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [ctype, setCtype] = useState("Doorway");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ rooms: Room[] }>("/hi/rooms/map"); setRooms(d.rooms.filter((r) => r.id !== roomId)); } catch {}
  }, [roomId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const done = () => router.replace(`/home-intel/rooms/${roomId}`);

  const save = async () => {
    if (!target && !newName.trim()) { Alert.alert("Pick a room", "Select an existing room or name a new one."); return; }
    setSaving(true);
    try {
      await api("/hi/rooms/connections", { method: "POST", body: {
        room_id: roomId, connected_room_id: target || undefined,
        new_room_name: !target ? newName.trim() : undefined, connection_type: ctype,
      } });
      done();
    } catch (e: any) { Alert.alert("Couldn't connect", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Connect Rooms" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Text style={styles.q}>What room connects to this one?</Text>
        <Text style={styles.help}>This builds a simple map of your home — no floor plan needed.</Text>

        {rooms.length > 0 && (
          <>
            <Text style={styles.label}>Existing rooms</Text>
            <View style={styles.chips}>
              {rooms.map((r) => (
                <Pressable key={r.id} testID={`conn-room-${r.id}`} style={[styles.chip, target === r.id && styles.chipOn]} onPress={() => { setTarget(r.id); setNewName(""); }}>
                  <Text style={[styles.chipText, target === r.id && styles.chipTextOn]}>{r.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>…or add a new room</Text>
        <TextInput testID="conn-newname" style={styles.input} value={newName} onChangeText={(t) => { setNewName(t); if (t) setTarget(null); }} placeholder="e.g. Hallway" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={styles.label}>How are they connected?</Text>
        <View style={styles.chips}>
          {CONNECTION_TYPES.map((c) => (
            <Pressable key={c} testID={`conn-type-${c}`} style={[styles.chip, ctype === c && styles.chipOn]} onPress={() => setCtype(c)}>
              <Text style={[styles.chipText, ctype === c && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable testID="conn-save" style={[styles.primary, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save connection</Text>}
        </Pressable>
        <Pressable testID="conn-skip" style={styles.skip} onPress={done}><Text style={styles.skipText}>Skip for now</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  q: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  skip: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
  skipText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
