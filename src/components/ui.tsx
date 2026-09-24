import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  radii,
  spacing,
  useAppStyles,
  useAppTheme,
} from '../theme';
import type { BirbalTheme } from '../theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const t = useAppTheme();
  const styles = baseStyles(t);
  const style = [styles.screen, padded && styles.padded];
  if (scroll) {
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={style}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.flex, style]}>{children}</View>;
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object | object[];
}) {
  const styles = useAppStyles((c) => cardStyles(c));
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  multiline = false,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  right,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'decimal-pad';
  right?: React.ReactNode;
}) {
  const t = useAppTheme();
  const [focused, setFocused] = useState(false);
  const styles = useAppStyles((c) => inputStyles(c));
  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          style={[
            styles.input,
            multiline && styles.textArea,
            focused && { borderColor: t.accent, backgroundColor: t.surfaceElevated },
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? label}
          placeholderTextColor={t.textSecondary}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {right ? <View style={styles.inputRight}>{right}</View> : null}
      </View>
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'danger';
  style?: object | object[];
}) {
  const t = useAppTheme();
  const styles = useAppStyles((c) => buttonStyles(c));
  if (variant === 'primary') {
    return (
      <LinearGradient
        colors={t.gradient.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, styles.buttonPrimary, (disabled || loading) && styles.buttonDisabled, style]}>
        <Pressable
          onPress={onPress}
          disabled={disabled || loading}
          style={styles.buttonPressable}>
          {loading ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={styles.buttonTextPrimary}>{title}</Text>
          )}
        </Pressable>
      </LinearGradient>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'outline' ? styles.buttonOutline : styles.buttonDanger,
        (disabled || pressed) && styles.buttonDisabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? t.accent : t.onAccent} />
      ) : (
        <Text style={variant === 'outline' ? styles.buttonTextOutline : styles.buttonTextDanger}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({
  text,
  color,
}: {
  text: string;
  color?: string;
}) {
  const t = useAppTheme();
  const active = color ?? t.accent;
  return (
    <View style={{ backgroundColor: `${active}20`, alignSelf: 'flex-start', borderRadius: radii.full }}>
      <Text style={{ color: active, fontSize: 12, fontWeight: '600', paddingHorizontal: spacing.md, paddingVertical: 4 }}>
        {text}
      </Text>
    </View>
  );
}

export function EmptyState({ icon, message }: { icon: string; message: string }) {
  const styles = useAppStyles((c) => emptyStyles(c));
  return (
    <View style={styles.empty}>
      <View style={styles.iconWrap}>
        <Text style={styles.emptyIcon}>{icon}</Text>
      </View>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  const t = useAppTheme();
  if (!error) return null;
  return <Text style={{ color: t.danger, fontSize: 13, marginTop: spacing.xs }}>{error}</Text>;
}

export function FormScreen({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useAppTheme();
  const styles = useAppStyles((c) => formStyles(c, t.background));
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.screen, styles.padded]}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const baseStyles = (t: BirbalTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flexGrow: 1, paddingBottom: spacing.xxl, backgroundColor: t.background },
    padded: { padding: spacing.lg },
  });

const cardStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      padding: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      shadowColor: '#1C1530',
      shadowOpacity: 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
  });

const inputStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    inputWrap: { marginBottom: spacing.lg },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.xs + 2,
    },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.md + 1 : spacing.sm + 3,
      fontSize: 15,
      color: c.text,
    },
    textArea: { minHeight: 120, textAlignVertical: 'top', paddingTop: spacing.md },
    inputRight: {
      position: 'absolute',
      right: spacing.md,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
  });

const buttonStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    button: {
      height: 52,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: spacing.sm,
      borderWidth: 1,
    },
    buttonPressable: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.md,
    },
    buttonPrimary: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      shadowColor: '#1C1530',
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    buttonOutline: {
      backgroundColor: 'transparent',
      borderColor: c.accent,
    },
    buttonDanger: {
      backgroundColor: c.danger,
      borderColor: 'transparent',
    },
    buttonDisabled: { opacity: 0.55 },
    buttonTextPrimary: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    buttonTextOutline: { color: c.accent, fontSize: 16, fontWeight: '700' },
    buttonTextDanger: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  });

const emptyStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    empty: { alignItems: 'center', paddingVertical: 64 },
    iconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    emptyIcon: { fontSize: 30 },
    emptyText: { color: c.textSecondary, fontSize: 14, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
  });

const formStyles = (c: BirbalTheme, bg: string) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flexGrow: 1, paddingBottom: spacing.xxl },
    padded: { padding: spacing.lg, backgroundColor: bg },
  });