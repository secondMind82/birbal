import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorText, FormScreen, Input } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import * as notesService from '../services/notesService';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EditNote'>;

export default function EditNoteScreen({ route, navigation }: Props) {
  const { note } = route.params;
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [pinned, setPinned] = useState(note.pinned);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);
    try {
      await notesService.updateNote(userId, note.id, { title: title.trim(), content, pinned });
      navigation.goBack();
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
        placeholder="Write your note here..."
      />

      <View style={styles.pinRow}>
        <Text style={styles.pinLabel}>📌 Pin this note</Text>
        <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: colors.accent }} />
      </View>

      <ErrorText error={error} />

      <Button
        title="Update Note"
        onPress={() => void handleUpdate()}
        loading={loading}
        disabled={!title.trim()}
        style={{ marginTop: spacing.md }}
      />
      <Button title="Cancel" variant="outline" onPress={() => navigation.goBack()} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pinLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
});
