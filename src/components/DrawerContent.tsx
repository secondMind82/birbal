import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useAuthStore } from '../store/authStore';
import { useAppTheme, useAppStyles } from '../theme';
import type { BirbalTheme } from '../theme';

const MENU_ITEMS: { label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { label: 'Dashboard', icon: 'home-outline', route: 'Dashboard' },
  { label: 'Expenses', icon: 'wallet-outline', route: 'Expenses' },
  { label: 'Timeline', icon: 'pulse-outline', route: 'Timeline' },
  { label: 'Calendar', icon: 'calendar-outline', route: 'Calendar' },
  { label: 'Entities', icon: 'people-outline', route: 'Entities' },
  { label: 'Notes', icon: 'document-text-outline', route: 'Notes' },
  { label: 'Diary', icon: 'book-outline', route: 'Diary' },
  { label: 'Settings', icon: 'settings-outline', route: 'Settings' },
] as const;

export default function DrawerContent(props: DrawerContentComponentProps) {
  const activeRoute = props.state.routes[props.state.index]?.name;
  const logout = useAuthStore((s) => s.logout);
  const theme = useAppTheme();
  const styles = useAppStyles((c) => drawerStyles(c));

  return (
    <LinearGradient
      colors={theme.gradient.ink}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
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
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => props.navigation.navigate(item.route as never)}>
              <View style={[styles.itemIconWrap, selected && styles.itemIconWrapSelected]}>
                <Ionicons
                  name={item.icon}
                  size={19}
                  color={selected ? '#FFFFFF' : theme.sidebarIcon}
                />
              </View>
              <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]}>
                {item.label}
              </Text>
              {selected ? <Ionicons name="checkmark-circle" size={16} color="#B79DFF" /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />
      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        onPress={() => void logout()}>
        <View style={styles.itemIconWrap}>
          <Ionicons name="log-out-outline" size={19} color={theme.sidebarIcon} />
        </View>
        <Text style={styles.logoutLabel}>Logout</Text>
      </Pressable>
    </LinearGradient>
  );
}

const drawerStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    gradient: { flex: 1, paddingHorizontal: 12 },
    logo: {
      width: 220,
      height: 104,
      alignSelf: 'center',
      marginTop: 36,
      marginBottom: 16,
    },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)', marginVertical: 10 },
    menu: { flex: 1 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 16,
      marginBottom: 4,
    },
    itemSelected: { backgroundColor: c.sidebarSelected },
    itemIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    itemIconWrapSelected: { backgroundColor: 'rgba(183,157,255,0.22)' },
    itemLabel: { flex: 1, color: c.sidebarIcon, fontSize: 15, fontWeight: '600' },
    itemLabelSelected: { color: '#FFFFFF', fontWeight: '700' },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 16,
      marginBottom: 24,
    },
    logoutIcon: { fontSize: 18 },
    logoutLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });