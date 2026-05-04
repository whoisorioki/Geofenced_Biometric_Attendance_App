import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import ClassSelectScreen from '../screens/ClassSelectScreen';
import MarkAttendanceScreen from '../screens/MarkAttendanceScreen';
import HistoryScreen from '../screens/HistoryScreen';

export default function AppNavigator() {
  const Stack = createNativeStackNavigator();
  
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen 
          name="Login" 
          component={LoginScreen}
          options={{
            title: 'JKUAT Attendance System',
            headerStyle: { backgroundColor: '#080810' },
            headerTitleStyle: { color: '#00D4FF', fontWeight: 'bold' },
            headerTintColor: '#00D4FF',
          }}
        />
        <Stack.Screen 
          name="ClassSelect" 
          component={ClassSelectScreen}
          options={{
            title: 'Select Class Session',
            headerStyle: { backgroundColor: '#080810' },
            headerTitleStyle: { color: '#00D4FF', fontWeight: 'bold' },
            headerTintColor: '#00D4FF',
          }}
        />
        <Stack.Screen 
          name="CheckIn" 
          component={MarkAttendanceScreen}
          options={{
            title: 'Mark Attendance',
            headerStyle: { backgroundColor: '#080810' },
            headerTitleStyle: { color: '#00D4FF', fontWeight: 'bold' },
            headerTintColor: '#00D4FF',
          }}
        />
        <Stack.Screen 
          name="History" 
          component={HistoryScreen}
          options={{
            title: 'Attendance History',
            headerStyle: { backgroundColor: '#080810' },
            headerTitleStyle: { color: '#00D4FF', fontWeight: 'bold' },
            headerTintColor: '#00D4FF',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
