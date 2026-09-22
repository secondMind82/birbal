import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import * as diaryService from '../services/diaryService';
import { spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewDiary'>;

export default function PreviewDiaryScreen({ route, navigation }: Props) {
  const { entry } = route.params;
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);

  const confirmDelete = () => {
    Alert.alert('Delete Entry', `"${entry.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          diaryService.deleteEntry(userId, entry.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.mood}>Mood: {entry.mood}</Text>
        <Text style={styles.date}>{(entry.entryDate ?? '').slice(0, 10)}</Text>
        <Text style={styles.title}>{entry.title}</Text>
        <Text style={styles.content}>{entry.content}</Text>
      </Card>

      <Button title="Edit" onPress={() => navigation.navigate('EditDiary', { entry })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  mood: { fontSize: 12, fontWeight: '700', color: t.accent, textTransform: 'uppercase' },
  date: { fontSize: 12, color: t.textSecondary, marginTop: 4 },
  title: { fontSize: 22, fontWeight: '800', color: t.text, marginTop: spacing.md },
  content: { fontSize: 15, lineHeight: 24, color: t.text, marginTop: spacing.md },
} as const);
