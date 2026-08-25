import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';

const MENU_ITEMS = [
  { label: 'Dashboard', icon: '🏠', route: 'Dashboard' },
  { label: 'Timeline', icon: '📊', route: 'Timeline' },
  { label: 'Calendar', icon: '📅', route: 'Calendar' },
  { label: 'Entities', icon: '👥', route: 'Entities' },
  { label: 'Notes', icon: '📝', route: 'Notes' },
  { label: 'Diary', icon: '📖', route: 'Diary' },
  { label: 'Settings', icon: '⚙️', route: 'Settings' },
] as const;

export default function DrawerContent(props: DrawerContentComponentProps) {
  const activeRoute = props.state.routes[props.state.index]?.name;
  const logout = useAuthStore((s) => s.logout);

  return (
    <LinearGradient
      colors={[colors.sidebarStart, colors.sidebarEnd]}
      style={styles.gradient}>
      <Text style={styles.logo}>Birbal</Text>
      <View style={styles.divider} />

      <View style={styles.menu}>
        {MENU_ITEMS.map((item) => {
          const selected = activeRoute === item.route;
          return (
            <Pressable
              key={item.route}
              style={({ pressed }) => [
                styles.item,
                selected && styles.itemSelected,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => props.navigation.navigate(item.route as never)}>
              <Text style={styles.itemIcon}>{item.icon}</Text>
              <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />
      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        onPress={() => void logout()}>
        <Text style={styles.logoutIcon}>🚪</Text>
        <Text style={styles.logoutLabel}>Logout</Text>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1, paddingHorizontal: 12 },
  logo: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 60,
    marginBottom: 16,
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 8 },
  menu: { flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 2,
  },
  itemSelected: { backgroundColor: colors.sidebarSelected },
  itemIcon: { fontSize: 18 },
  itemLabel: { color: colors.sidebarIcon, fontSize: 15, fontWeight: '600' },
  itemLabelSelected: { color: '#fff' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 24,
  },
  logoutIcon: { fontSize: 18 },
  logoutLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
