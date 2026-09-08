import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FontAwesome } from '@expo/vector-icons';
import { Button, ErrorText, Input } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { signOutFromGoogle } from '../../services/socialAuth';
import { colors, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Signup'>;

export default function SignupScreen({ navigation }: Props) {
  const signup = useAuthStore((s) => s.signup);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const loginWithApple = useAuthStore((s) => s.loginWithApple);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  useEffect(() => {
    void signOutFromGoogle();
  }, []);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handleSignup = async () => {
    const ok = await signup(fullName.trim(), email.trim(), password);
    if (!ok) return;
    navigation.replace('Main');
  };

  const handleGoogleLogin = async () => {
    const ok = await loginWithGoogle();
    if (!ok) return;
    navigation.replace('Main');
  };

  const handleAppleLogin = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Apple Sign-In', 'Apple Sign-In sirf iOS pe available hai.');
      return;
    }
    const ok = await loginWithApple();
    if (!ok) return;
    navigation.replace('Main');
  };

  const valid =
    fullName.trim().length > 0 && email.trim().length > 0 && password.length >= 6;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Birbal</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start building your second memory today.</Text>

          <Input label="Full Name" value={fullName} onChangeText={setFullName} />

          <Input
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <View>
            <Input
              label="Password (min 6 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!passwordVisible}
              right={
                <Pressable onPress={() => setPasswordVisible(!passwordVisible)} hitSlop={8}>
                  <Text style={styles.show}>{passwordVisible ? 'Hide' : 'Show'}</Text>
                </Pressable>
              }
            />
          </View>

          <ErrorText error={error} />

          <Button
            title="Sign Up"
            onPress={() => void handleSignup()}
            loading={isLoading}
            disabled={!valid}
            style={{ marginTop: spacing.md }}
          />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={styles.socialButton}
            onPress={() => void handleGoogleLogin()}>
            <FontAwesome name="google" size={20} color="#DB4437" />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </Pressable>

          <Pressable
            style={styles.socialButton}
            onPress={() => void handleAppleLogin()}>
            <FontAwesome name="apple" size={22} color="#1A1A1A" />
            <Text style={[styles.socialButtonText, { color: '#1A1A1A' }]}>
              Continue with Apple
            </Text>
          </Pressable>

          <View style={styles.row}>
            <Text style={styles.rowText}>Already have an account? </Text>
            <Pressable onPress={() => navigation.goBack()}>
              <Text style={styles.link}>Login</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: '#F5F7FB',
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: radii.lg,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  show: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  rowText: { fontSize: 14 },
  link: { color: colors.accent, fontWeight: '700', fontSize: 14 },
});
