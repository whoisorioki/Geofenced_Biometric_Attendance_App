import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { executeSQL } from '../services/snowflake.service';

export default function HistoryScreen({ route, navigation }) {
  const studentId = route?.params?.studentId;
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) {
      Alert.alert(
        'Session Expired',
        'Please log in again to continue.',
        [{ text: 'Go to Login', onPress: () => navigation.replace('Login') }]
      );
      setLoading(false);
      return;
    }

    loadHistory();
  }, [studentId]);

  const loadHistory = async () => {
    try {
      const query = `
        WITH COURSE_LATEST AS (
          SELECT
            COURSE_ID,
            COURSE_TITLE,
            ROW_NUMBER() OVER (PARTITION BY COURSE_ID ORDER BY CREATED_AT DESC) AS RN
          FROM ATTENDANCE_DB.CORE.DIM_COURSE
        )
        SELECT 
          f.CHECK_IN_TIME,
          TO_VARCHAR(f.CHECK_IN_TIME, 'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME_EAT,
          f.STATUS,
          COALESCE(c.CLASS_ID, f.CLASS_ID) AS CLASS_ID,
          COALESCE(co.COURSE_TITLE, f.COURSE_ID) AS COURSE_TITLE,
          ST_X(f.DEVICE_LOCATION::GEOMETRY) AS longitude,
          ST_Y(f.DEVICE_LOCATION::GEOMETRY) AS latitude
        FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE f
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM c ON f.CLASS_ID = c.CLASS_ID
        LEFT JOIN COURSE_LATEST co ON f.COURSE_ID = co.COURSE_ID AND co.RN = 1
        WHERE f.STUDENT_ID = ?
        ORDER BY f.CHECK_IN_TIME DESC
        LIMIT 20
      `;

      const result = await executeSQL(query, {
        "1": { type: "TEXT", value: studentId }
      });

      setHistory(result.data || []);
    } catch (error) {
      console.error('Failed to load history:', error);
      Alert.alert(
        'Load Failed',
        error.message || 'Could not load attendance history.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => {
            setLoading(true);
            loadHistory();
          } },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PRESENT': return '#00C864';
      case 'PROXY-BLOCKED': return '#FF4444';
      case 'ABSENT-OUT-OF-BOUNDS': return '#FFB800';
      case 'WRONG-TIME-OR-DAY': return '#FFB800';
      default: return '#00D4FF';
    }
  };

  const getStatusEmoji = (status) => {
    switch (status) {
      case 'PRESENT': return '✅';
      case 'PROXY-BLOCKED': return '🚫';
      case 'ABSENT-OUT-OF-BOUNDS': return '📍';
      case 'WRONG-TIME-OR-DAY': return '⏰';
      default: return '❓';
    }
  };

  const getLocationNote = (status) => {
    switch (status) {
      case 'PRESENT': return 'Location verified for classroom check-in.';
      case 'ABSENT-OUT-OF-BOUNDS': return 'Check-in attempt was outside classroom boundary.';
      case 'PROXY-BLOCKED': return 'Attempt blocked due to registered-device mismatch.';
      case 'WRONG-TIME-OR-DAY': return 'Attempt made outside scheduled class time.';
      default: return 'Location summary unavailable.';
    }
  };

  const renderHistoryItem = ({ item }) => (
    <View style={styles.historyItem}>
      <View style={styles.statusContainer}>
        <Text style={styles.statusEmoji}>{getStatusEmoji(item[2])}</Text>
        <Text style={[styles.statusText, { color: getStatusColor(item[2]) }]}> 
          {item[2]}
        </Text>
      </View>
      
      <Text style={styles.classText}>{item[3]} - {item[4]}</Text>
      <Text style={styles.timeText}>
        {item[1]} EAT
      </Text>

      <Text style={styles.locationSummary}>{getLocationNote(item[2])}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#00D4FF" />
        <Text style={styles.loadingText}>Loading attendance history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Attendance History</Text>
      <Text style={styles.subtitle}>Student: {studentId}</Text>

      {history.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No attendance records found</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          renderItem={renderHistoryItem}
          keyExtractor={(item, index) => index.toString()}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080810',
    padding: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00D4FF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 20,
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 14,
    marginTop: 12,
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
    textAlign: 'center',
  },
  listContainer: {
    paddingBottom: 20,
  },
  historyItem: {
    backgroundColor: '#12121e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#00D4FF',
    borderColor: '#1e1e2e',
    borderWidth: 1,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusEmoji: {
    fontSize: 18,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  classText: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 4,
  },
  timeText: {
    color: '#888888',
    fontSize: 14,
    marginBottom: 4,
  },
  locationSummary: {
    color: '#888888',
    fontSize: 12,
  },
});