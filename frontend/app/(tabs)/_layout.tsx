import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, font } from "@/src/theme";
import { FeedbackFab } from "@/src/components/FeedbackFab";

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brandPrimary,
          tabBarInactiveTintColor: colors.onSurfaceTertiary,
          tabBarStyle: {
            backgroundColor: colors.surfaceSecondary,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: Platform.OS === "ios" ? 86 : 64,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("tabs.home"),
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="hard-hat" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="projects"
          options={{
            title: t("tabs.projects"),
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="clipboard-list-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="supplies"
          options={{
            title: t("tabs.supplies"),
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="cart-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: t("tabs.proearn"),
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-group-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t("tabs.profile"),
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-circle-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
      <FeedbackFab />
    </View>
  );
}
