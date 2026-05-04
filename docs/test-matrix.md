# Manual Test Matrix — JKUAT Attendance App

| # | Test Case | Input | Expected STATUS | Actual STATUS | Pass/Fail |
|---|-----------|-------|-----------------|---------------|-----------|
| 1 | Valid student inside geofence during scheduled time | STU001, correct class, inside NSC_MAIN | PRESENT | PRESENT | Pass |
| 2 | Valid student outside geofence | STU001, correct class, outside building | ABSENT-OUT-OF-BOUNDS | ABSENT-OUT-OF-BOUNDS | Pass |
| 3 | Check-in outside scheduled time window | STU001, correct class, wrong time | WRONG-TIME-OR-DAY | WRONG-TIME-OR-DAY | Pass |
| 4 | Unknown student ID | STUXXXXX, any class | No record inserted | No record inserted | Pass |
| 5 | Biometric cancelled by user | Any student, cancel prompt | App shows retry alert, no DB write | Not yet tested | Pending |
| 6 | GPS permission denied | Any student, deny location | App blocks button, shows message | Not yet tested | Pending |