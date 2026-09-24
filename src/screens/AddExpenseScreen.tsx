import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Chip, ErrorText, FormScreen, Input } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import * as expensesService from '../services/expensesService';
import {
  EXPENSE_CATEGORIES,
  formatPaise,
  isExpenseCategory,
  parseAmountToPaise,
} from '../utils/money';
import { spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AddExpense'>;

function formatDate(d: Date): string {
  return d.toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

export default function AddExpenseScreen({ navigation }: Props) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);

  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<string>('Other');
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveEnabled =
    !loading && description.trim().length > 0 && parseAmountToPaise(amountText) !== null;

  const handleSave = async () => {
    const paise = parseAmountToPaise(amountText);
    if (!paise) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (!description.trim()) {
      setError('Please add a short description.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const eventDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        time.getHours(),
        time.getMinutes(),
        0,
        0,
      );
      await expensesService.createExpense(userId, {
        title: description.trim(),
        description: description.trim(),
        eventDate: eventDate.toISOString(),
        amountPaise: paise,
        category: isExpenseCategory(category) ? category : 'Other',
      });
      navigation.goBack();
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <FormScreen>
      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="e.g. Grocery Shopping from D-Mart"
      />

      <Input
        label="Amount (₹)"
        value={amountText}
        onChangeText={setAmountText}
        placeholder="e.g. 1,250 or 1250.50"
        keyboardType="numeric"
        right={<Text style={styles.rightCurrency}>₹</Text>}
      />
      {parseAmountToPaise(amountText) !== null ? (
        <Text style={styles.previewAmount}>
          {formatPaise(parseAmountToPaise(amountText))}
        </Text>
      ) : null}

      <Text style={styles.label}>Category</Text>
      <View style={styles.chipsRow}>
        {EXPENSE_CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => setCategory(c)}>
            <View style={{ opacity: category === c ? 1 : 0.45 }}>
              <Chip text={c} color={category === c ? t.accent : t.textSecondary} />
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.fieldRow} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Text style={styles.fieldValue}>{formatDate(date)}</Text>
      </Pressable>

      <Pressable style={styles.fieldRow} onPress={() => setShowTimePicker(true)}>
        <Text style={styles.fieldLabel}>Time</Text>
        <Text style={styles.fieldValue}>{formatTime(time)}</Text>
      </Pressable>

      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          onChange={(_, picked) => {
            setShowDatePicker(false);
            if (picked) setDate(picked);
          }}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={time}
          mode="time"
          is24Hour={false}
          onChange={(_, picked) => {
            setShowTimePicker(false);
            if (picked) setTime(picked);
          }}
        />
      )}

      <ErrorText error={error} />

      <Button
        title="Save Expense"
        onPress={() => void handleSave()}
        loading={loading}
        disabled={!saveEnabled}
        style={{ marginTop: spacing.md }}
      />
      <Button title="Cancel" variant="outline" onPress={() => navigation.goBack()} />
    </FormScreen>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  label: { fontSize: 13, fontWeight: '600', color: t.text, marginBottom: spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  rightCurrency: { color: t.textSecondary, fontSize: 16, fontWeight: '700' },
  previewAmount: {
    color: t.accent,
    fontSize: 13,
    fontWeight: '700',
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: t.textSecondary },
  fieldValue: { fontSize: 15, fontWeight: '700', color: t.text },
}) as const;