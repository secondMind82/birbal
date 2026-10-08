import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import BirbalChatMessage from '../components/BirbalChatMessage';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';
import { askBirbal } from '../services/birbalAiService';
import type { AiChatTurn } from '../api/apiService';
import { useAuthStore } from '../store/authStore';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

// Quick actions. "Read" actions send a real query to the (read-only) AI; the
// write-style actions (Add Note / Add Expense) are not performed — Birbal is a
// read-only assistant, and any AI "action" is only ever described, never done.
const QUICK_ACTIONS: { label: string; prompt: string; icon: IconName; readOnly: boolean }[] = [
  { label: "Today's Summary", prompt: "Show me today's summary", icon: 'stats-chart-outline', readOnly: true },
  { label: 'Pending Credits', prompt: 'Which credits are pending?', icon: 'cash-outline', readOnly: true },
  { label: 'Add Note', prompt: 'I want to add a note', icon: 'document-text-outline', readOnly: false },
  { label: 'Add Expense', prompt: 'I want to add an expense', icon: 'wallet-outline', readOnly: false },
];

const ACTION_PLACEHOLDER =
  "That's a write action, and I'm read-only for now — note-taking and expense creation will arrive in a future Birbal AI update.";

const CONNECT_ERROR = "Sorry, I couldn't connect right now. Please try again.";
const EMPTY_ERROR = "I couldn't find an answer to that. Could you rephrase, please?";

export default function BirbalAssistantScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);
  const userName = useAuthStore((s) => s.user?.fullName);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const historyRef = useRef<AiChatTurn[]>([]);

  // Keep the live conversation window trimmed so the request stays small.
  function pushHistory(turn: AiChatTurn) {
    historyRef.current = [...historyRef.current, turn].slice(-12);
  }

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages]);

  const respond = async (text: string) => {
    const result = await askBirbal(userId, userName, text, historyRef.current);
    if (result.ok) {
      pushHistory({ role: 'assistant', text: result.reply! });
      return result.reply!;
    }
    return result.reason === 'empty' ? EMPTY_ERROR : CONNECT_ERROR;
  };

  const send = async (raw: string, readOnly: boolean) => {
    const text = raw.trim();
    if (!text || sending) return;
    idRef.current += 1;
    const userMsg: ChatMessage = { id: `m-${idRef.current}`, role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    pushHistory({ role: 'user', text });

    if (!readOnly) {
      // Birbal is read-only: acknowledge the ask without performing any action.
      idRef.current += 1;
      const reply: ChatMessage = { id: `m-${idRef.current}`, role: 'assistant', text: ACTION_PLACEHOLDER };
      setMessages((prev) => [...prev, reply]);
      return;
    }

    setSending(true);
    const replyText = await respond(text);
    setSending(false);

    if (replyText) {
      idRef.current += 1;
      const reply: ChatMessage = { id: `m-${idRef.current}`, role: 'assistant', text: replyText };
      setMessages((prev) => [...prev, reply]);
    }
  };

  const canSend = input.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        {messages.length === 0 ? (
          <View style={styles.hero}>
            <View style={styles.heroHalo}>
              <LinearGradient
                colors={t.gradient.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroAvatar}>
                <MaterialCommunityIcons name="robot" size={38} color="#FFFFFF" />
              </LinearGradient>
            </View>
            <Text style={styles.heroTitle}>Hi, I'm Birbal 👋</Text>
            <Text style={styles.heroSubtitle}>How can I help you today?</Text>

            <View style={styles.actionsGrid}>
              {QUICK_ACTIONS.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => void send(action.prompt, action.readOnly)}
                  style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}>
                  <View style={styles.actionIconWrap}>
                    <Ionicons name={action.icon} size={16} color={t.accent} />
                  </View>
                  <Text style={styles.actionLabel}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {messages.map((m) => (
          <BirbalChatMessage key={m.id} role={m.role} text={m.text} />
        ))}
        {sending ? <BirbalChatMessage role="assistant" text="" typing /> : null}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask Birbal anything..."
          placeholderTextColor={t.textSecondary}
          returnKeyType="send"
          onSubmitEditing={() => void send(input, true)}
          accessibilityLabel="Ask Birbal anything"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={!canSend}
          onPress={() => void send(input, true)}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendButtonDisabled,
            pressed && canSend && styles.sendButtonPressed,
          ]}>
          <Ionicons name="send" size={17} color={t.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  screen: { flex: 1, backgroundColor: t.background },
  thread: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  hero: { alignItems: 'center', paddingTop: spacing.xl, marginBottom: spacing.sm },
  heroHalo: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1C1530',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  heroTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: t.text,
    marginTop: spacing.lg,
  },
  heroSubtitle: { fontSize: 14, color: t.textSecondary, marginTop: spacing.xs },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  actionCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  actionCardPressed: { opacity: 0.7, backgroundColor: t.surfaceVariant },
  actionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: t.text },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: t.surface,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  input: {
    flex: 1,
    height: 46,
    borderRadius: radii.full,
    backgroundColor: t.surfaceVariant,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.lg,
    fontSize: 14,
    color: t.text,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendButtonPressed: { opacity: 0.85 },
}) as const;
