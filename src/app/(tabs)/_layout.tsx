// Нижние вкладки: Смена · Установки · Законы · Склад · Ещё.
// Иконки: SF Symbols на iPhone, Material Symbols на Android и в браузере.
import { Tabs } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/lib/i18n';
import { colors, font } from '@/lib/theme';

const icon = (ios: SFSymbol, md: AndroidSymbol) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={{ ios, android: md, web: md }} tintColor={color} size={28} />;
  };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.infoBg,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontSize: font.tab, fontWeight: '700', letterSpacing: -0.2 },
        tabBarItemStyle: { paddingHorizontal: 0 },
        tabBarStyle: {
          height: 66 + insets.bottom,
          paddingBottom: insets.bottom,
          borderTopWidth: 1.5,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tab.training'), tabBarIcon: icon('graduationcap.fill', 'school') }} />
      <Tabs.Screen name="library" options={{ title: t('tab.library'), tabBarIcon: icon('wrench.and.screwdriver.fill', 'hvac') }} />
      <Tabs.Screen name="laws" options={{ title: t('tab.laws'), tabBarIcon: icon('building.columns.fill', 'gavel') }} />
      <Tabs.Screen name="sklad" options={{ title: t('tab.sklad'), tabBarIcon: icon('shippingbox.fill', 'inventory_2') }} />
      <Tabs.Screen name="more" options={{ title: t('tab.more'), tabBarIcon: icon('ellipsis.circle.fill', 'more_horiz') }} />
    </Tabs>
  );
}
