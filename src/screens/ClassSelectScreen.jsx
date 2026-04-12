import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { executeSQL } from '../services/snowflake.service';

const COURSE_COLUMNS_SQL = `
  SELECT COLUMN_NAME
  FROM ATTENDANCE_DB.INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'CORE'
    AND TABLE_NAME = 'DIM_COURSE'
  ORDER BY ORDINAL_POSITION
`;

const CLASSROOMS_SQL = `
  SELECT CLASS_ID, BUILDING_NAME
  FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
  ORDER BY CLASS_ID
`;

const quoteSql = (value) => String(value ?? '').replace(/'/g, "''");

// Module-level cache — column schema never changes between sessions.
// Avoids repeating the slow INFORMATION_SCHEMA query on every navigation.
let _columnSchemaCache = null;

const buildCoursesQuery = ({
  hasCourseTitle,
  hasLecturerName,
  hasDayOfWeek,
  hasStartTime,
  hasEndTime,
  hasClassId,
  fallbackClassId,
  fallbackBuildingName,
}) => {
  const classIdExpr = hasClassId
    ? 'CR.CLASS_ID'
    : `'${quoteSql(fallbackClassId || '')}'`;

  const buildingExpr = hasClassId
    ? `COALESCE(
         C.BUILDING_NAME || ' - ' || C.ROOM_NUMBER,
         C.BUILDING_NAME,
         'Unknown Building'
       )`
    : `'${quoteSql(fallbackBuildingName || 'Unknown Building')}'`;

  const joinClause = hasClassId
    ? `LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM C
       ON C.CLASS_ID = CR.CLASS_ID`
    : '';

  const orderClause = hasDayOfWeek
    ? `ORDER BY
         CASE CR.DAY_OF_WEEK
           WHEN 'MONDAY' THEN 1
           WHEN 'TUESDAY' THEN 2
           WHEN 'WEDNESDAY' THEN 3
           WHEN 'THURSDAY' THEN 4
           WHEN 'FRIDAY' THEN 5
           ELSE 6
         END,
         ${hasStartTime ? 'CR.START_TIME,' : ''}
         CR.COURSE_ID`
    : 'ORDER BY CR.COURSE_ID';

  return `
    SELECT
      CR.COURSE_ID,
      ${hasCourseTitle ? 'CR.COURSE_TITLE' : 'CR.COURSE_ID'} AS COURSE_TITLE,
      ${hasLecturerName ? 'CR.LECTURER_NAME' : 'NULL'} AS LECTURER_NAME,
      ${hasDayOfWeek ? 'CR.DAY_OF_WEEK' : 'NULL'} AS DAY_OF_WEEK,
      ${hasStartTime ? 'CR.START_TIME' : 'NULL'} AS START_TIME,
      ${hasEndTime ? 'CR.END_TIME' : 'NULL'} AS END_TIME,
      ${classIdExpr} AS CLASS_ID,
      ${buildingExpr} AS BUILDING_NAME
    FROM ATTENDANCE_DB.CORE.DIM_COURSE CR
    ${joinClause}
    ${orderClause}
  `;
};

export default function ClassSelectScreen({ route, navigation }) {
  const studentId = route?.params?.studentId;
  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState('Waking up database\u2026');
  const [sessions, setSessions] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);

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

    loadSessions();
  }, [studentId]);

  const loadSessions = async () => {
    try {
      let columnSet = _columnSchemaCache;

      if (columnSet) {
        // Cache hit — skip the INFORMATION_SCHEMA round-trip entirely
        setLoadPhase('Loading timetable\u2026');
        console.log('\u26a1 Column schema served from cache');
      } else {
        // Fetch schema + classrooms in parallel — they are independent queries
        setLoadPhase('Loading timetable\u2026');
        const [columnsResult, classroomsResultEarly] = await Promise.all([
          executeSQL(COURSE_COLUMNS_SQL, {}),
          executeSQL(CLASSROOMS_SQL, {}),
        ]);
        columnSet = new Set(
          (columnsResult?.data || []).map((row) => String(row[0] || '').toUpperCase())
        );
        _columnSchemaCache = columnSet;
        // Reuse the already-fetched classrooms result
        var _earlyClassroomsResult = classroomsResultEarly;
      }

      const classroomsResult = typeof _earlyClassroomsResult !== 'undefined'
        ? _earlyClassroomsResult
        : await executeSQL(CLASSROOMS_SQL, {});

      const fallbackClassroom = (classroomsResult?.data || [])[0] || [];
      const fallbackClassId = fallbackClassroom[0] || '';
      const fallbackBuildingName = fallbackClassroom[1] || 'Unknown Building';

      const hasCourseTitle  = columnSet.has('COURSE_TITLE');
      const hasLecturerName = columnSet.has('LECTURER_NAME');
      const hasDayOfWeek    = columnSet.has('DAY_OF_WEEK');
      const hasStartTime    = columnSet.has('START_TIME');
      const hasEndTime      = columnSet.has('END_TIME');
      const hasClassId      = columnSet.has('CLASS_ID');

      setLoadPhase('Building session list\u2026');

      const coursesQuery = buildCoursesQuery({
        hasCourseTitle,
        hasLecturerName,
        hasDayOfWeek,
        hasStartTime,
        hasEndTime,
        hasClassId,
        fallbackClassId,
        fallbackBuildingName,
      });

      const result = await executeSQL(coursesQuery, {});

      const mapped = (result?.data || []).map((row) => ({
        courseId: row[0],
        courseTitle: row[1],
        lecturerName: row[2],
        dayOfWeek: row[3],
        startTime: row[4],
        endTime: row[5],
        classId: row[6],
        buildingName: row[7] || row[6] || 'Unknown Building',
      }));

      if (!hasClassId) {
        Alert.alert(
          'Schema Notice',
          'DIM_COURSE.CLASS_ID is missing in Snowflake. Using default classroom mapping until schema is updated.'
        );
      }

      setSessions(mapped);
    } catch (error) {
      console.error('Failed to load timetable:', error);
      Alert.alert(
        'Load Failed',
        error.message || 'Could not fetch timetable.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => {
            setLoading(true);
            loadSessions();
          } },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = (session) => {
    if (isSelecting) return;

    if (!session.classId) {
      Alert.alert('Missing Classroom', 'This session has no CLASS_ID mapped yet in Snowflake.');
      return;
    }

    setIsSelecting(true);
    navigation.navigate('CheckIn', {
      studentId,
      courseId: session.courseId,
      selectedClassId: session.classId,
      selectedBuildingName: session.buildingName,
      selectedCourseTitle: session.courseTitle,
    });

    setTimeout(() => setIsSelecting(false), 300);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, isSelecting && styles.cardDisabled]}
      onPress={() => handleSelectSession(item)}
      disabled={isSelecting}
      accessibilityLabel={`Select session ${item.courseId}`}
      accessibilityHint="Opens attendance check-in for this class session"
    >
      <Text style={styles.courseCode}>{item.courseId}</Text>
      <Text style={styles.courseTitle}>{item.courseTitle}</Text>
      <Text style={styles.meta}>
        {(item.dayOfWeek || 'DAY TBA')} • {(item.startTime || '--:--')} - {(item.endTime || '--:--')}
      </Text>
      <Text style={styles.meta}>👨‍🏫 {item.lecturerName || 'TBD'}</Text>
      <Text style={styles.location}>📍 {item.buildingName} ({item.classId})</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#00D4FF" />
        <Text style={styles.loadingText}>{loadPhase}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Session</Text>
      <Text style={styles.subtitle}>Student: {studentId}</Text>

      {sessions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No sessions found in DIM_COURSE</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item, index) => `${item.courseId}-${item.classId}-${index}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
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
  center: {
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
    marginBottom: 18,
  },
  loadingText: {
    marginTop: 12,
    color: '#888888',
    fontSize: 14,
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#12121e',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardDisabled: {
    opacity: 0.7,
  },
  courseCode: {
    color: '#00D4FF',
    fontSize: 16,
    fontWeight: '800',
  },
  courseTitle: {
    color: '#ffffff',
    fontSize: 15,
    marginTop: 3,
    marginBottom: 6,
  },
  meta: {
    color: '#888888',
    fontSize: 12,
    marginBottom: 3,
  },
  location: {
    color: '#00D4FF',
    fontSize: 12,
    marginTop: 2,
  },
});
