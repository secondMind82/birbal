import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { socialAuthConfig } from '../config/socialAuth';

GoogleSignin.configure({
  webClientId: socialAuthConfig.webClientId,
  iosClientId: socialAuthConfig.iosClientId,
  offlineAccess: false,
});

export class SocialAuthCancelledError extends Error {
  constructor() {
    super('Sign-In cancelled');
    this.name = 'SocialAuthCancelledError';
  }
}

export class SocialAuthUnavailableError extends Error {
  constructor() {
    super('Sign-In unavailable on this device');
    this.name = 'SocialAuthUnavailableError';
  }
}

export interface AppleSignInResult {
  identityToken: string;
  email?: string | null;
  fullName?: string;
}

function formatAppleFullName(
  name: AppleAuthentication.AppleAuthenticationFullName | null,
): string | undefined {
  if (!name) return undefined;
  const full =
    [name.givenName, name.familyName].filter(Boolean).join(' ').trim() ||
    name.nickname?.trim();
  return full || undefined;
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  if (Platform.OS !== 'ios') {
    throw new SocialAuthUnavailableError();
  }

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential || !credential.identityToken) {
      throw new SocialAuthUnavailableError();
    }
    return {
      identityToken: credential.identityToken,
      email: credential.email,
      fullName: formatAppleFullName(credential.fullName),
    };
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code?: string }).code === 'ERR_REQUEST_CANCELED'
    ) {
      throw new SocialAuthCancelledError();
    }
    throw e;
  }
}

// Clears the cached Google account so the account-picker shows on every tap.
export async function signOutFromGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // no-op: nothing signed in yet
  }
}

export async function signInWithGoogle(): Promise<string> {
  try {
    await GoogleSignin.hasPlayServices();
    await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();
    return tokens.idToken;
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code?: string }).code === statusCodes.SIGN_IN_CANCELLED
    ) {
      throw new SocialAuthCancelledError();
    }
    throw e;
  }
}