import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';

import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TimelineScreen from '../screens/TimelineScreen';
import CalendarScreen from '../screens/CalendarScreen';
import EntitiesScreen from '../screens/EntitiesScreen';
import NotesScreen from '../screens/NotesScreen';
import DiaryScreen from '../screens/DiaryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AddEventScreen from '../screens/AddEventScreen';
import CreateNoteScreen from '../screens/CreateNoteScreen';
import CreateEntityScreen from '../screens/CreateEntityScreen';
import EditNoteScreen from '../screens/EditNoteScreen';
import EditEntityScreen from '../screens/EditEntityScreen';
import EditDiaryScreen from '../screens/EditDiaryScreen';
import PreviewNoteScreen from '../screens/PreviewNoteScreen';
import PreviewEntityScreen from '../screens/PreviewEntityScreen';
import PreviewTimelineScreen from '../screens/PreviewTimelineScreen';
import PreviewDiaryScreen from '../screens/PreviewDiaryScreen';
import DrawerContent from '../components/DrawerContent';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.sidebarStart },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' as const },
  contentStyle: { backgroundColor: colors.background },
};

function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: { width: 280, backgroundColor: 'transparent' },
        overlayColor: 'rgba(0,0,0,0.5)',
      }}>
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="Timeline" component={TimelineScreen} />
      <Drawer.Screen name="Calendar" component={CalendarScreen} />
      <Drawer.Screen name="Entities" component={EntitiesScreen} />
      <Drawer.Screen name="Notes" component={NotesScreen} />
      <Drawer.Screen name="Diary" component={DiaryScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

export default function AppNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const restoring = useAuthStore((s) => s.restoring);

  if (restoring) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ marginTop: 12, color: colors.textSecondary }}>Birbal</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <>
              <Stack.Screen
              name="Main"
              component={MainDrawer}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="NewNote" component={CreateNoteScreen} options={{ title: 'New Note' }} />
            <Stack.Screen name="NewEntity" component={CreateEntityScreen} options={{ title: 'New Entity' }} />
            <Stack.Screen name="AddEvent" component={AddEventScreen} options={{ title: 'Add Event' }} />
            <Stack.Screen name="EditTimeline" component={AddEventScreen} options={{ title: 'Edit Timeline' }} />
            <Stack.Screen name="NewDiaryEntry" component={EditDiaryScreen} options={{ title: 'New Entry' }} />

            <Stack.Screen name="EditNote" component={EditNoteScreen} options={{ title: 'Edit Note' }} />
            <Stack.Screen name="EditEntity" component={EditEntityScreen} options={{ title: 'Edit Entity' }} />
            <Stack.Screen name="EditDiary" component={EditDiaryScreen} options={{ title: 'Edit Diary' }} />

            <Stack.Screen name="PreviewNote" component={PreviewNoteScreen} options={{ title: 'Note' }} />
            <Stack.Screen name="PreviewEntity" component={PreviewEntityScreen} options={{ title: 'Entity' }} />
            <Stack.Screen name="PreviewTimeline" component={PreviewTimelineScreen} options={{ title: 'Event' }} />
            <Stack.Screen name="PreviewDiary" component={PreviewDiaryScreen} options={{ title: 'Entry' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
