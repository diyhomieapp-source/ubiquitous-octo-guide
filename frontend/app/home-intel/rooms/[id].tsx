import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function RoomProfile() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api(`/hi/rooms/${id}/profile`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Room" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const rm = data.room;

  return (
    <View style={styles.root}>
      <ScreenHeader title={rm.name} right={
        <Pressable testID="room-update" onPress={() => router.push(`/home-intel/rooms/update?id=${id}`)}>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {rm.cover_photo_base64 && <Image source={{ uri: `data:image/jpeg;base64,${rm.cover_photo_base64}` }} style={styles.cover} contentFit="cover" />}
        <Text style={styles.type}>{rm.room_type || "Room"}{rm.floor_name ? ` · ${rm.floor_name}` : ""}</Text>
        {(rm.approximate_length || rm.approximate_width) && <Text style={styles.dims}>Approx {rm.approximate_length || "?"} × {rm.approximate_width || "?"}{rm.approximate_ceiling_height ? ` × ${rm.approximate_ceiling_height} ceiling` : ""} (user-entered)</Text>}
        {rm.status === "changed_use" && <Text style={styles.changed}>Purpose changed — history preserved</Text>}
        {!!rm.notes && <Text style={styles.notes}>{rm.notes}</Text>}

        <View style={styles.btnRow}>
          <ActionBtn testID="room-add-asset" icon="cube-outline" label="Add Asset" onPress={() => router.push(`/home-intel/asset-add?roomId=${id}&roomName=${encodeURIComponent(rm.name)}`)} />
          <ActionBtn testID="room-report-issue" icon="alert-outline" label="Report Issue" onPress={() => router.push(`/home-intel/help?roomId=${id}`)} />
        </View>
        <View style={styles.btnRow}>
          <ActionBtn testID="room-start-project" icon="hammer-wrench" label="Start Project" onPress={() => router.push(`/home-intel/projects/start?roomId=${id}`)} />
          <ActionBtn testID="room-update-2" icon="pencil-outline" label="Update Room" onPress={() => router.push(`/home-intel/rooms/update?id=${id}`)} />
        </View>

        <Section title={`Connected rooms (${data.connected_rooms.length})`} />
        {data.connected_rooms.length === 0 ? <Text style={styles.empty}>No connections yet.</Text> :
          data.connected_rooms.map((c: any, i: number) => (
            <View key={i} style={styles.row}><MaterialCommunityIcons name="arrow-right-thin" size={18} color={colors.brandPrimary} /><Text style={styles.rowText}>{c.name} · {c.connection_type}</Text></View>
          ))}

        <Section title={`Assets (${data.assets.length})`} />
        {data.assets.length === 0 ? <Text style={styles.empty}>No assets here yet.</Text> :
          data.assets.map((a: any) => (
            <Pressable key={a.id} style={styles.row} onPress={() => router.push(`/home-intel/asset/${a.id}`)}>
              <MaterialCommunityIcons name="cube-outline" size={18} color={colors.brandPrimary} /><Text style={styles.rowText}>{a.name} · {a.category}</Text>
            </Pressable>
          ))}

        <Section title={`Open issues (${data.open_issues.length})`} />
        {data.open_issues.length === 0 ? <Text style={styles.empty}>No open issues.</Text> :
          data.open_issues.map((iss: any) => (
            <Pressable key={iss.id} style={styles.row} onPress={() => router.push(`/home-intel/guidance?issueId=${iss.id}`)}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.warning} /><Text style={styles.rowText} numberOfLines={1}>{iss.user_description}</Text>
            </Pressable>
          ))}

        <Section title={`Documents (${data.documents.length})`} />
        {data.documents.length === 0 ? <Text style={styles.empty}>No documents linked.</Text> :
          data.documents.map((d: any) => (
            <View key={d.id} style={styles.row}><MaterialCommunityIcons name="file-document-outline" size={18} color={colors.brandPrimary} /><Text style={styles.rowText}>{d.document_type}</Text></View>
          ))}
      </ScrollView>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, testID }: any) {
  return <Pressable testID={testID} style={styles.action} onPress={onPress}>
    <MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} /><Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}
function Section({ title }: { title: string }) { return <Text style={styles.section}>{title}</Text>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  cover: { width: "100%", height: 170, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  type: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.md },
  dims: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  changed: { color: colors.info, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  notes: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm, lineHeight: 22 },
  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  actionText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  rowText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
});
