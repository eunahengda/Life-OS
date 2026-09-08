import { Tabs } from 'expo-router';

import { colors } from '../../src/constants/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="life" options={{ title: 'Life' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance' }} />
      <Tabs.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Tabs.Screen name="documents" options={{ title: 'Documents' }} />
      {/* Task 030: Add and Search remain real routes (reachable from the
          Home FAB and the Home search bar respectively) but are no longer
          bottom-tab destinations — `href: null` keeps a screen in this
          Tabs navigator without giving it a tab bar entry. */}
      <Tabs.Screen name="add" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
