import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Advisory = { level: "warn" | "info" | "good"; icon: any; text: string };
type Weather = { location?: string; region?: string; temp_f?: number; condition?: string };

const LEVEL_COLOR: Record<string, string> = {
  warn: colors.warning,
  info: colors.brandPrimary,
  good: colors.success,
};

export function WeatherBanner({ location }: { location?: string }) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async (q: string) => {
    if (!q) { setNeedsLocation(true); return; }
    setLoading(true);
    setNeedsLocation(false);
    try {
      const res = await api<{ weather: Weather; advisories: Advisory[] }>(`/weather?q=${encodeURIComponent(q)}`);
      setWeather(res.weather);
      setAdvisories(res.advisories || []);
    } catch {
      // keep silent — banner just won't show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (location) load(location);
    else setNeedsLocation(true);
  }, [location, load]);

  const usePreciseLocation = async () => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted" && perm.canAskAgain) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== "granted") {
        setBlocked(!perm.canAskAgain);
        if (location) load(location);
        return;
      }
      setBlocked(false);
      setLoading(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      await load(`${pos.coords.latitude},${pos.coords.longitude}`);
    } catch {
      if (location) load(location);
    }
  };

  if (loading && !weather) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.brandPrimary} />
        <Text style={styles.muted}>Checking today’s conditions…</Text>
      </View>
    );
  }

  if (needsLocation && !weather) {
    return (
      <Pressable style={styles.card} onPress={usePreciseLocation}>
        <MaterialCommunityIcons name="map-marker-radius" size={20} color={colors.brandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Get weather-smart tips</Text>
          <Text style={styles.muted}>
            {blocked ? "Location is blocked — enable it in Settings, or add your ZIP in Profile." : "Tap to use your location, or add your ZIP/city in Profile."}
          </Text>
        </View>
        {blocked && Platform.OS !== "web" && (
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.settings}>Settings</Text>
          </Pressable>
        )}
      </Pressable>
    );
  }

  if (!weather) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <MaterialCommunityIcons name="weather-partly-cloudy" size={22} color={colors.brandPrimary} />
        <Text style={styles.headText}>
          {(weather.location || "Your area").toUpperCase()} · {Math.round(weather.temp_f ?? 0)}°F {weather.condition}
        </Text>
        <Pressable onPress={usePreciseLocation} hitSlop={8} style={styles.pin}>
          <MaterialCommunityIcons name="crosshairs-gps" size={16} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>
      {advisories.slice(0, 3).map((a, i) => (
        <View key={i} style={[styles.tip, { borderLeftColor: LEVEL_COLOR[a.level] || colors.brandPrimary }]}>
          <MaterialCommunityIcons name={a.icon} size={18} color={LEVEL_COLOR[a.level] || colors.brandPrimary} />
          <Text style={styles.tipText}>{a.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radius.md, padding: spacing.md, gap: spacing.sm,
  },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radius.md, padding: spacing.md,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  pin: { padding: 2 },
  tip: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, borderLeftWidth: 3, borderRadius: radius.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  tipText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  muted: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  settings: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
