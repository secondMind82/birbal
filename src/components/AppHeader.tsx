import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNotificationStore } from '../store/notificationStore';
import { colors } from '../theme';

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

  return (
    <View style={styles.header}>
      <Pressable onPress={onOpenDrawer} hitSlop={10} style={styles.iconBtn}>
        <Text style={styles.menuIcon}>☰</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable onPress={onOpenNotifications} hitSlop={10} style={styles.iconBtn}>
        <Text style={styles.bellIcon}>🔔</Text>
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.sidebarStart,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    gap: 4,
  },
  iconBtn: { padding: 8 },
  menuIcon: { color: '#fff', fontSize: 22 },
  bellIcon: { fontSize: 20 },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
