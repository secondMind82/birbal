import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotificationStore } from '../store/notificationStore';
import { useAppTheme } from '../theme';

export default function AppHeader({
  title,
  onOpenDrawer,
  onOpenNotifications,
}: {
  title: string;
  onOpenDrawer: () => void;
  onOpenNotifications: () => void;
}) {
  const badge = useNotificationStore((s) => s.notificationCount);
  const theme = useAppTheme();

  return (
    <View style={styles.header}>
      <Pressable onPress={onOpenDrawer} hitSlop={10} style={styles.iconBtn}>
        <Ionicons name="menu" size={22} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable onPress={onOpenNotifications} hitSlop={10} style={styles.iconBtn}>
        <Ionicons name="notifications-outline" size={21} color="#FFFFFF" />
        {badge > 0 && (
          <View style={[styles.badge, { backgroundColor: theme.danger }]}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 4,
  },
  iconBtn: { padding: 8, borderRadius: 12 },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});