import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorText, FormScreen, Input } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { SmsClassification, SmsMessage } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as smsService from '../services/smsService';
import { formatPaise } from '../utils/money';
import { parseActivity } from '../utils/activityParser';
import { spacing, useAppTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SmsReview'>;

/**
 * The review step for a captured SMS.
 *
 * This screen is the only place a message can become a record, and the edited
 * text is what gets parsed — the original body is only the starting point. That
 * is what makes "detect, then let the user fix it" safe: nothing is written until
 * the user taps Save, and the app never invents a transaction the user did not
 * confirm.
 */
export default function SmsReviewScreen({ route, navigation }: Props) {
  const { smsId } = route.params;
  const theme = useAppTheme();
  const userId = useAuthStore((s) => s.user?.id) ?? null;

  const [message, setMessage] = useState<SmsMessage | null>(null);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<SmsClassification | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const found = await smsService.getMessage(userId, smsId);
      if (!active) return;
      if (!found) {
        Alert.alert('Message not found', 'This message is no longer available.');
        navigation.goBack();
        return;
      }
      setMessage(found);
      setText(found.body);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId, smsId, navigation]);

  // The hint follows the user's edits: change the text and the app re-says what
  // it thinks it is, so the classification is never a stale guess.
  useEffect(() => {
    if (!message) return;
    setHint(smsService.hintFor({ ...message, body: text }));
  }, [message, text]);

  const handleIgnore = useCallback(async () => {
    if (!userId || !message) return;
    try {
      await smsService.ignoreSms(userId, message.id);
      navigation.goBack();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [userId, message, navigation]);

  const handleSave = useCallback(async () => {
    if (!userId || !message) return;
    const edited = text.trim();
    if (!edited) {
      setError('Nothing to save');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await smsService.saveSms(userId, { smsId: message.id, text: edited });
      navigation.goBack();
    } catch (e) {
      setError(getErrorMessage(e));
      setSaving(false);
    }
  }, [userId, message, text, navigation]);

  if (loading) {
    return <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />;
  }
  if (!message) return null;

  const parsed = parseActivity(text);
  const amount = parsed.money?.amountPaise ?? 0;

  return (
    <FormScreen>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
        Review message
      </Text>
      <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>
        From {smsService.describeSender(message.sender)}
      </Text>

      <View style={{ height: spacing.md }} />

      <Input
        label="Message"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Edit the message before saving"
      />

      {hint ? (
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: -spacing.md }}>
          {hint.kind === 'financial'
            ? `Detected: financial message — ${hint.reason.toLowerCase()}.`
            : hint.kind === 'otp'
              ? `Detected: verification code — ${hint.reason.toLowerCase()}.`
              : `Detected: no financial details (${hint.reason.toLowerCase()}).`}
        </Text>
      ) : null}

      {amount > 0 ? (
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginTop: spacing.md }}>
          {parsed.money?.role === 'receive' ? 'Money to receive' : 'Expense'}:{' '}
          {formatPaise(amount)}
          {parsed.money?.category ? ` · ${parsed.money.category}` : ''}
        </Text>
      ) : null}

      {message.isOtp ? (
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: spacing.md }}>
          This looks like a verification code. It is masked in notifications and forgotten
          once you have dealt with it.
        </Text>
      ) : null}

      <ErrorText error={error} />

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Button
          title="Ignore"
          variant="outline"
          onPress={() => void handleIgnore()}
          disabled={saving}
          style={{ flex: 1 }}
        />
        <Button
          title="Save"
          onPress={() => void handleSave()}
          loading={saving}
          disabled={saving}
          style={{ flex: 1 }}
        />
      </View>
    </FormScreen>
  );
}
