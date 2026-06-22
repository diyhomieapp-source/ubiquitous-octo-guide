import { Redirect, Stack } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/src/auth";
import { colors } from "@/src/theme";

export default function AdminLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }
  if (!user || !user.is_admin) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
