import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

// Module-level navigation ref so non-component code (notification tap handlers,
// service callbacks) can navigate without hooks or a navigator context.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();