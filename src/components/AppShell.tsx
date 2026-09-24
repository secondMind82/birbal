import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import AppHeader from './AppHeader';
import NotificationCenter from './NotificationCenter';
import { useNotificationStore } from '../store/notificationStore';
import type { AppNotification } from '../models/types';
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
  const refresh = useNotificationStore((s) => s.refresh);

  useEffect(() => {
    startPolling();
  }, [startPolling]);

  const openFromNotification = (n: AppNotification) => {
    switch (n.type) {
      case 'EVENT':
      case 'REMINDER':
        navigation.navigate('Calendar');
        break;
      case 'BIRTHDAY':
        navigation.navigate('Entities');
        break;
      case 'TIMELINE':
        navigation.navigate('Timeline');
        break;
      case 'SYSTEM':
        break;
    }
  };

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
            void refresh();
            setNotifVisible(true);
          }}
        />
      </LinearGradient>
      <View style={styles.content}>{children}</View>
      <NotificationCenter
        visible={notifVisible}
        onClose={() => setNotifVisible(false)}
        onOpenNotification={openFromNotification}
      />
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