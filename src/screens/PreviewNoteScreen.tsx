import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import * as notesService from '../services/notesService';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewNote'>;

export default function PreviewNoteScreen({ route, navigation }: Props) {
  const { note } = route.params;
  const userId = useAuthStore((s) => s.user?.id);

  const confirmDelete = () => {
    Alert.alert('Delete Note', `"${note.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          notesService.deleteNote(userId, note.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{note.title}</Text>
          {note.pinned ? <Text style={{ fontSize: 20 }}>📌</Text> : null}
        </View>
        <Text style={styles.date}>Updated {(note.updatedAt ?? '').slice(0, 10)}</Text>
        <Text style={styles.content}>{note.content}</Text>
      </Card>

      <Button title="Edit" onPress={() => navigation.navigate('EditNote', { note })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text },
  date: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
  content: { fontSize: 15, lineHeight: 24, color: colors.text },
});
