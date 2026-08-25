import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorText, FormScreen, Input } from '../components/ui';
import { createDiaryEntry, updateDiaryEntry } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { DiaryEntry } from '../models/types';
import { colors, radii, spacing } from '../theme';

const MOODS = ['HAPPY', 'CALM', 'EXCITED', 'GRATEFUL', 'SAD', 'ANXIOUS'];

type Props =
  | NativeStackScreenProps<RootStackParamList, 'NewDiaryEntry'>
  | NativeStackScreenProps<RootStackParamList, 'EditDiary'>;

export default function EditDiaryScreen(props: Props) {
  const existing: DiaryEntry | undefined = props.route.params?.entry;
  return <DiaryForm existing={existing} onDone={() => props.navigation.goBack()} />;
}

function DiaryForm({ existing, onDone }: { existing?: DiaryEntry; onDone: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [mood, setMood] = useState(existing?.mood ?? 'HAPPY');
  const [entryDate, setEntryDate] = useState(
    (existing?.entryDate ?? new Date().toISOString()).slice(0, 10),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        content,
        mood,
        entryDate: `${entryDate}T00:00:00Z`,
      };
      if (existing) {
        await updateDiaryEntry(existing.id, body);
      } else {
        await createDiaryEntry(body);
      }
      onDone();
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <FormScreen>
      <Input label="Title" value={title} onChangeText={setTitle} />
      <Input
        label="Content"
        value={content}
        onChangeText={setContent}
        multiline
        placeholder="How was your day?"
      />

      <Text style={styles.label}>Mood</Text>
      <View style={styles.chipsRow}>
        {MOODS.map((m) => (
          <Pressable key={m} onPress={() => setMood(m)}>
            <View
              style={[
                styles.moodChip,
                mood === m ? styles.moodChipSelected : styles.moodChipUnselected,
              ]}>
              <Text style={[styles.moodText, mood === m && styles.moodTextSelected]}>{m}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Input
        label="Entry Date (YYYY-MM-DD)"
        value={entryDate}
        onChangeText={setEntryDate}
        autoCapitalize="none"
      />

      <ErrorText error={error} />

      <Button
        title={existing ? 'Update Entry' : 'Save Entry'}
        onPress={() => void handleSave()}
        loading={loading}
        disabled={!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)}
        style={{ marginTop: spacing.md }}
      />
      <Button title="Cancel" variant="outline" onPress={onDone} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  moodChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  moodChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  moodChipUnselected: { backgroundColor: '#fff', borderColor: colors.border },
  moodText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  moodTextSelected: { color: '#fff' },
});
