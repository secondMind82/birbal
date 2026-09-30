import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import AppHeader from './AppHeader';
import NotificationCenter, { type SmsCaptureInfo } from './NotificationCenter';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';
import * as smsService from '../services/smsService';
import { getSmsPermissionStatus, offerSmsCapture } from '../services/smsPermission';
import { pendingSmsCount } from '../../modules/birbal-sms';
import type { AppNotification } from '../models/types';
import type { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme';

type DrawerNav = DrawerNavigationProp<Record<string, object | undefined>>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export default function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation<DrawerNav>();
  // The shell lives inside the drawer but targets stack routes (SmsReview), so the
  // stack navigator is reached through the same navigation object.
  const rootNav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const [notifVisible, setNotifVisible] = useState(false);
  const [smsCapture, setSmsCapture] = useState<SmsCaptureInfo | null>(null);
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
      case 'SMS':
        // Tapping the card opens the review screen; the record it creates then
        // shows up in the normal Timeline notifications.
        rootNav.navigate('SmsReview', { smsId: n.id.replace(/^sms-/, '') });
        break;
      case 'SYSTEM':
        break;
    }
  };

  const editSms = (smsId: string) => {
    rootNav.navigate('SmsReview', { smsId });
  };

  const ignoreSms = (smsId: string) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    void (async () => {
      await smsService.ignoreSms(userId, smsId);
      await refresh();
    })();
  };

  /** Re-reads capture state so the Bell can explain itself instead of going quiet. */
  const readCaptureState = async (): Promise<SmsCaptureInfo> => {
    const supported = smsService.isSmsCaptureSupported();
    const status = await getSmsPermissionStatus(supported);
    const pending = await pendingSmsCount();
    const info = { status, pending };
    setSmsCapture(info);
    return info;
  };

  const openNotifications = async () => {
    await refresh();
    setNotifVisible(true);
    // Opening the bell is where the user expects messages to be. If the SMS
    // permission was never granted, nothing could ever have arrived, so explain
    // once here instead of leaving the app looking broken. Granting it means the
    // receiver starts working mid-session, so drain straight afterwards.
    const grantedNow = await offerSmsCapture(smsService.isSmsCaptureSupported());
    if (grantedNow) {
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        await smsService.ingestCapturedSms(userId).catch(() => ({ added: 0, unsupported: false }));
        await refresh();
      }
    }
    await readCaptureState();
  };

  /** The Bell's own "Turn on" action: same one-ask flow, then re-read the state. */
  const enableSms = async () => {
    const grantedNow = await offerSmsCapture(smsService.isSmsCaptureSupported());
    if (grantedNow) {
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        await smsService.ingestCapturedSms(userId).catch(() => ({ added: 0, unsupported: false }));
        await refresh();
      }
    }
    await readCaptureState();
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
            void openNotifications();
          }}
        />
      </LinearGradient>
      <View style={styles.content}>{children}</View>
      <NotificationCenter
        visible={notifVisible}
        onClose={() => setNotifVisible(false)}
        onOpenNotification={openFromNotification}
        onEditSms={editSms}
        onIgnoreSms={ignoreSms}
        smsCapture={smsCapture}
        onEnableSms={() => void enableSms()}
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