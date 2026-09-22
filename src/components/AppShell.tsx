import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import AppHeader from './AppHeader';
import NotificationCenter from './NotificationCenter';
import { useNotificationStore } from '../store/notificationStore';
import { useAppTheme } from '../theme';

type DrawerNav = DrawerNavigationProp<Record<string, object | undefined>>;

export default function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation<DrawerNav>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const [notifVisible, setNotifVisible] = useState(false);
  const startPolling = useNotificationStore((s) => s.startPolling);
  const fetchReminders = useNotificationStore((s) => s.fetchReminders);

  useEffect(() => {
    startPolling();
  }, [startPolling]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.sidebarStart} />
      <LinearGradient
        colors={theme.gradient.ink}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.headerWrap, { paddingTop: insets.top }]}>
        <AppHeader
          title={title}
          onOpenDrawer={() => navigation.openDrawer()}
          onOpenNotifications={() => {
            void fetchReminders();
            setNotifVisible(true);
          }}
        />
      </LinearGradient>
      <View style={styles.content}>{children}</View>
      <NotificationCenter visible={notifVisible} onClose={() => setNotifVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerWrap: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
  },
  content: { flex: 1 },
});