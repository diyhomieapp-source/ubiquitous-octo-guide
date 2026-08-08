import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const ROLES = [
  { key: "viewer", label: "Viewer", desc: "Read-only" },
  { key: "contributor", label: "Contributor", desc: "Add notes, photos, complete tasks" },
  { key: "editor", label: "Editor", desc: "Create & edit rooms, projects, docs" },
  { key: "property_manager", label: "Manager", desc: "Manage everything but ownership" },
  { key: "professional_guest", label: "Pro Guest", desc: "Temporary, expiring access" },
];

export default function CollabManage() {
  const [props, setProps] = useState<any[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("viewer");
  const [lastInvite, setLastInvite] = useState<any>(null);

  const loadProps = useCallback(async () => {
    try { const d = await api<any>("/hi/collab/owned"); setProps(d.properties); if (d.properties[0]) setPid((p) => p || d.properties[0].id); }
    catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { loadProps(); }, [loadProps]));

  const loadMembers = useCallback(async () => {
    if (!pid) return;
    try {
      const [m, i] = await Promise.all([api<any>(`/hi/collab/properties/${pid}/members`), api<any>(`/hi/collab/properties/${pid}/invites`)]);
      setMembers(m.members); setInvites(i.invites);
    } catch {}
  }, [pid]);
  useFocusEffect(useCallback(() => { loadMembers(); }, [loadMembers]));

  const sendInvite = async () => {
    if (!email.trim() || !email.includes("@")) { Alert.alert("Email needed", "Enter a valid email."); return; }
    setBusy(true);
    try { const r = await api<any>(`/hi/collab/properties/${pid}/invite`, { method: "POST", body: { invited_email: email.trim(), invited_role: role } }); setLastInvite(r); setEmail(""); await loadMembers(); }
    catch (e: any) { Alert.alert("Couldn't invite", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const changeRole = async (mid: string, newRole: string) => {
    setBusy(true);
    try { await api(`/hi/collab/members/${mid}/role`, { method: "PUT", body: { role: newRole } }); await loadMembers(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const remove = (mid: string) => Alert.alert("Remove collaborator?", "Their access is revoked immediately.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: async () => { setBusy(true); try { await api(`/hi/collab/members/${mid}/remove`, { method: "POST" }); await loadMembers(); } catch {} finally { setBusy(false); } } },
  ]);
  const revokeInvite = async (iid: string) => { setBusy(true); try { await api(`/hi/collab/invites/${iid}/revoke`, { method: "POST" }); await loadMembers(); } catch {} finally { setBusy(false); } };

  if (loading) return <View style={styles.root}><ScreenHeader title="Share & Collaborators" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Share & Collaborators" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        {props.length === 0 ? <Text style={styles.empty}>Add a property first to start sharing.</Text> : (
          <>
            {props.length > 1 && (
              <View style={styles.wrap}>
                {props.map((p) => (
                  <Pressable key={p.id} style={[styles.chip, pid === p.id && styles.chipOn]} onPress={() => setPid(p.id)}><Text style={[styles.chipText, pid === p.id && { color: "#fff" }]}>{p.name}</Text></Pressable>
                ))}
              </View>
            )}
            <Text style={styles.intro}>Invite people to help with this property. They only see what you share — never your billing, rewards, private chats, or other homes.</Text>

            <Text style={styles.section}>Invite someone</Text>
            <TextInput testID="cb-email" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="their@email.com" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={styles.roleList}>
              {ROLES.map((rr) => (
                <Pressable key={rr.key} testID={`cb-role-${rr.key}`} style={[styles.roleRow, role === rr.key && styles.roleOn]} onPress={() => setRole(rr.key)}>
                  <View style={{ flex: 1 }}><Text style={[styles.roleName, role === rr.key && { color: colors.brandPrimary }]}>{rr.label}</Text><Text style={styles.roleDesc}>{rr.desc}</Text></View>
                  {role === rr.key && <MaterialCommunityIcons name="check-circle" size={18} color={colors.brandPrimary} />}
                </Pressable>
              ))}
            </View>
            <Pressable testID="cb-invite" style={styles.primary} disabled={busy} onPress={sendInvite}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Send invitation</Text>}
            </Pressable>

            {lastInvite && (
              <View style={styles.tokenCard}>
                <Text style={styles.tokenTitle}>Invite created ({lastInvite.role_label})</Text>
                <Text style={styles.tokenHint}>Share this code with them — they enter it under Shared with me, then Accept invite.</Text>
                <Text testID="cb-token" selectable style={styles.tokenCode}>{lastInvite.invite_token}</Text>
              </View>
            )}

            <Text style={styles.section}>Collaborators ({members.length})</Text>
            {members.length === 0 ? <Text style={styles.empty}>No collaborators yet.</Text> :
              members.map((m) => (
                <View key={m.id} testID={`cb-member-${m.id}`} style={styles.memberCard}>
                  <View style={styles.memberTop}>
                    <MaterialCommunityIcons name="account-circle-outline" size={22} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.name || m.email || "Collaborator"}</Text>
                      <Text style={styles.memberMeta}>{m.role_label}{m.expires_at ? " · expires" : ""}{m.status !== "active" ? ` · ${m.status}` : ""}</Text>
                    </View>
                    <Pressable testID={`cb-remove-${m.id}`} disabled={busy} onPress={() => remove(m.id)} hitSlop={8}><MaterialCommunityIcons name="account-remove-outline" size={20} color={colors.error} /></Pressable>
                  </View>
                  <View style={styles.roleChips}>
                    {ROLES.filter((rr) => rr.key !== "professional_guest").map((rr) => (
                      <Pressable key={rr.key} disabled={busy} style={[styles.miniChip, m.role === rr.key && styles.chipOn]} onPress={() => changeRole(m.id, rr.key)}><Text style={[styles.miniText, m.role === rr.key && { color: "#fff" }]}>{rr.label}</Text></Pressable>
                    ))}
                  </View>
                </View>
              ))}

            {invites.length > 0 && (
              <>
                <Text style={styles.section}>Pending invites ({invites.length})</Text>
                {invites.map((iv) => (
                  <View key={iv.id} style={styles.inviteRow}>
                    <MaterialCommunityIcons name="email-outline" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={styles.inviteEmail} numberOfLines={1}>{iv.invited_email} · {iv.invited_role}</Text>
                    <Pressable testID={`cb-revoke-${iv.id}`} disabled={busy} style={styles.smallBtn} onPress={() => revokeInvite(iv.id)}><Text style={styles.smallBtnText}>Revoke</Text></Pressable>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.md },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  roleList: { marginTop: spacing.sm, gap: spacing.xs },
  roleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, padding: spacing.md },
  roleOn: { borderColor: colors.brandPrimary },
  roleName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  roleDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1 },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  tokenCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  tokenTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  tokenHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  tokenCode: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm },
  memberCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  memberTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  memberName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  memberMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1, textTransform: "capitalize" },
  roleChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  miniChip: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  miniText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 11 },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  inviteEmail: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  smallBtn: { borderColor: colors.error, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  smallBtnText: { color: colors.error, fontFamily: font.bold, fontSize: 11 },
});
