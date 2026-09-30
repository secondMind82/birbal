import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';

import { Button, Card } from './ui';
import { spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';
import * as smsService from '../services/smsService';
import { resetSmsPermissionAsk } from '../services/smsPermission';
import { useAuthStore } from '../store/authStore';

/**
 * Permission control for SIM SMS capture.
 *
 * The permission is opt-in and the copy says exactly what is granted and what is
 * not, because "receive SMS" is a sensitive ask and the user is entitled to
 * understand it before the system dialog appears. The flow is explain → request →
 * (deny → offer settings), which is why nothing is requested on mount.
 *
 * Only RECEIVE_SMS is ever requested. No contacts, call log or message history
 * access is involved, and the app never uploads a message body.
 *
 * React Native's PermissionsAndroid is used rather than expo-permissions because
 * SMS is not one of expo-permissions' coalesced media/location permissions.
 */

type Status = 'unsupported' | 'undetermined' | 'granted' | 'denied' | 'blocked';

const RECEIVE_SMS = PermissionsAndroid.PERMISSIONS.RECEIVE_SMS;

export default function SmsPermissionCard() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const [status, setStatus] = useState<Status>('undetermined');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    if (Platform.OS !== 'android' || !smsService.isSmsCaptureSupported()) {
      setStatus('unsupported');
      return;
    }
    // PermissionsAndroid.check() reports only granted/denied — it cannot tell a
    // first-time install from a permission that was already turned down — so a
    // not-granted result is reported honestly as 'denied' rather than pretending
    // the user has never been asked.
    const granted = await PermissionsAndroid.check(RECEIVE_SMS);
    setStatus(granted ? 'granted' : 'denied');
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const result = await PermissionsAndroid.request(RECEIVE_SMS);
      // 'never_ask_again' means Android will not show the dialog again, so the
      // only way forward is the system settings screen.
      setStatus(result === 'granted' ? 'granted' : result === 'never_ask_again' ? 'blocked' : 'denied');
      if (result === 'granted') {
        // Settings is the escape hatch from a refusal at the notification bell, so
        // granting here clears the remembered "Not now" and the bell stops asking.
        await resetSmsPermissionAsk();
        // The receiver only starts working once granted, and anything it captured
        // while the dialog was up is already queued natively.
        const userId = useAuthStore.getState().user?.id;
        if (userId) await smsService.ingestCapturedSms(userId).catch(() => undefined);
      }
    } catch {
      setStatus('denied');
    } finally {
      setBusy(false);
    }
  }, []);

  // Coming back from the system settings screen has to re-read the real state
  // rather than trust what was requested.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => subscription.remove();
  }, [read]);

  if (status === 'unsupported') {
    return (
      <Card>
        <Text style={styles.sectionTitle}>SMS Capture</Text>
        <Text style={styles.desc}>
          SMS capture is not available in this build, because the birbal-sms native
          module is missing from it. Nothing about your messages is being read, but
          incoming SIM messages cannot reach Birbal until the app is rebuilt with
          that module included.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.sectionTitle}>SMS Capture</Text>

      {status === 'granted' ? (
        <>
          <Text style={styles.desc}>
            Birbal can see incoming SIM messages. Each one appears in your notifications so
            you can turn it into an expense, a money-to-receive entry or a timeline event.
          </Text>
          <View style={styles.privacyBox}>
            <Text style={styles.privacyTitle}>What this does not do</Text>
            <Text style={styles.privacyLine}>
              • Messages are never uploaded — they stay on this device and are excluded from
              backups.
            </Text>
            <Text style={styles.privacyLine}>
              • Nothing is saved automatically. Every message waits for you to review it.
            </Text>
            <Text style={styles.privacyLine}>
              • Verification codes are masked in the notification and forgotten after a while.
            </Text>
            <Text style={styles.privacyLine}>
              • Your contacts and call log are never accessed.
            </Text>
          </View>
          <Pressable
            style={styles.link}
            onPress={() => {
              void Linking.openSettings();
            }}>
            <Text style={styles.linkText}>Turn off in Android settings</Text>
          </Pressable>
        </>
      ) : status === 'blocked' ? (
        <>
          <Text style={styles.desc}>
            SMS capture is turned off. Android will not ask again, so it has to be re-enabled
            in the system settings.
          </Text>
          <Button
            title="Open Android settings"
            onPress={() => {
              void Linking.openSettings();
            }}
            style={{ marginTop: spacing.md }}
          />
        </>
      ) : (
        <>
          <Text style={styles.desc}>
            Let Birbal read incoming SIM messages so a bank alert or a reminder from a friend
            can become an expense, a payment you are owed, or a timeline event — without you
            typing it in.
          </Text>
          {status === 'denied' ? (
            <Text style={styles.note}>
              Permission was declined. You can still turn it on below, or in Android settings.
            </Text>
          ) : null}
          <Button
            title="Enable SMS capture"
            onPress={() => {
              if (status === 'denied') {
                Alert.alert(
                  'Enable SMS capture?',
                  'Birbal will be able to read incoming SIM messages. They stay on this device and are never uploaded.',
                  [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Continue', onPress: () => void request() },
                  ],
                );
                return;
              }
              void request();
            }}
            loading={busy}
            disabled={busy}
            style={{ marginTop: spacing.md }}
          />
          <Pressable style={styles.link} onPress={() => void Linking.openSettings()}>
            <Text style={styles.linkText}>Open Android settings</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

const makeStyles = (c: BirbalTheme) =>
  ({
    sectionTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: c.text,
      marginBottom: spacing.xs,
    },
    desc: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    note: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: spacing.xs,
      fontStyle: 'italic',
    },
    privacyBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: 12,
      backgroundColor: c.surfaceVariant,
    },
    privacyTitle: { fontSize: 12, fontWeight: '800', color: c.text, marginBottom: 4 },
    privacyLine: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
    link: { marginTop: spacing.md, alignSelf: 'flex-start' },
    linkText: { fontSize: 12, fontWeight: '700', color: c.accent },
  }) as const;

export { makeStyles };
