# JKUAT Attendance System Final Report

**Date:** 2026-05-04  
**Prepared for:** Lecturer Presentation  
**Project:** Geofenced Biometric Attendance App (Expo + Snowflake + Streamlit)

## Abstract
This project implements a policy-driven attendance system that combines device-side evidence collection with cloud-side policy enforcement. The mobile client captures biometric confirmation, device identity, and GPS coordinates, while Snowflake evaluates timetable validity, classroom geofence proximity, and device compliance before writing final attendance status records.

The design intentionally isolates local operations (UI, biometric and GPS capture, retry/error UX, and release packaging) from Snowflake operations (policy decision engine, geospatial SQL checks, historical analytics, and Streamlit governance dashboards). This separation improves auditability and makes policy changes traceable in SQL.

The system currently demonstrates operational readiness with live evidence for performance instrumentation, attendance status outcomes, and cloud query context under the production API role.

## System Design Methodology
### 1. Architecture Pattern
The system follows a split-responsibility architecture:
1. **Local client (React Native / Expo):** collects identity and location evidence, manages user journey, and calls Snowflake SQL API.
2. **Snowflake policy layer:** computes attendance decision in SQL (`PRESENT`, `WRONG-TIME-OR-DAY`, `ABSENT-OUT-OF-BOUNDS`, `PROXY-BLOCKED`) and persists facts.
3. **Snowflake Streamlit dashboard:** reads facts and compliance metrics for administration and oversight.

### 2. End-to-End Processing Pipeline
1. Student enters ID and selects session.
2. App acquires location permission, location fix, and optional proximity pre-check.
3. Biometric confirmation is performed (mobile platforms).
4. Parameterized SQL is submitted through Snowflake SQL API with JWT keypair auth.
5. Snowflake SQL policy logic computes final status and inserts into `FACT_ATTENDANCE`.
6. Client reads latest inserted status and shows final student feedback.
7. Dashboard queries provide operations view (`Attendance Live`, `Audit`, `Geofence + Timetable`).

### 3. Isolation of Snowflake vs Local Operations
#### Local Operations
- UI rendering and navigation states.
- Biometric checks (`expo-local-authentication`).
- GPS watch/snapshot collection (`expo-location`).
- Device hash generation and local status gating.
- Release and OTA workflows (EAS build/update).

#### Snowflake Operations
- Policy decision logic (time/day, geofence distance, enrollment/device checks).
- Data persistence (`DIM_*`, `FACT_*`).
- Timetable and geofence governance.
- Streamlit analytics and compliance visualizations.
- Warehouse/session context and metering.

## Results and Demonstration Evidence
### A. HCI Performance Timing Data
From the HCI audit, performance checkpoints are instrumented and pass the target envelopes:

| Step | Target | Measured Evidence | Result |
|------|--------|-------------------|--------|
| T1: Tap -> biometric prompt | <= 1500 ms | Captured in Performance Debug panel after success | Pass |
| T2: Biometric success -> GPS start | <= 1000 ms | Captured in Performance Debug panel after success | Pass |
| T3: GPS complete -> Snowflake request sent | <= 1500 ms | Captured in Performance Debug panel after success | Pass |
| T4: Snowflake sent -> response received | <= 2500 ms | Captured in Performance Debug panel after success | Pass |
| T5: Total flow | <= 5000 ms | Captured in Performance Debug panel after success | Pass |

Additional benchmark artifact (`scripts/bench_results.txt`):
- `RUNS=2662,2906,3125`
- `AVG=2897.67 ms`
- `MIN=2662 ms`
- `MAX=3125 ms`

### B. FACT_ATTENDANCE Status Breakdown (Live Query)
Live Snowflake query result used for this report:

```sql
SELECT STATUS, COUNT(*) AS TOTAL
FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE
GROUP BY STATUS
ORDER BY TOTAL DESC;
```

Observed distribution:

| STATUS | TOTAL |
|--------|-------|
| WRONG-TIME-OR-DAY | 15 |
| PRESENT | 3 |
| ABSENT-OUT-OF-BOUNDS | 2 |

Interpretation:
1. Most failures are timetable-window mismatches (`WRONG-TIME-OR-DAY`), indicating data/scheduling governance is currently the main accuracy driver.
2. Geofence misses are present but lower volume than timetable misses.
3. Successful `PRESENT` writes confirm end-to-end policy flow is operational.

### C. Snowflake FinOps Credit Usage Evidence
Warehouse metering was queried through `INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY` under current role and warehouse context.

Context snapshot during evidence capture:
- `CURRENT_WAREHOUSE() = XS_ATTENDANCE_API_WH`
- `CURRENT_ROLE() = ATTENDANCE_APP_ROLE`
- `CURRENT_USER() = ATTENDANCE_API_USER`
- Timestamp: `2026-05-04 12:40:59 +0300`

FinOps query attempts:
1. `SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY` -> **not authorized** for this role.
2. `ATTENDANCE_DB.INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY(...)` -> query succeeded but returned **no rows** for requested windows.
3. 30-day aggregate for `XS_ATTENDANCE_API_WH` returned `NULL` (equivalent to no metering rows in result window at query time).

Reported value for this snapshot:
- **Credits (30-day, API role visibility): 0 / no rows returned**

Operational note:
- Metering visibility can depend on role privileges and data latency. For board-grade FinOps totals, rerun with an account-level role in Snowsight and export the same query output.

## Known Limitations
1. **FinOps visibility under app role is limited:** account-level metering views are not accessible; information schema returns no rows in current capture window.
2. **Timetable mismatch dominates failures:** `WRONG-TIME-OR-DAY` is the highest status count, suggesting timetable governance remains the largest accuracy bottleneck.
3. **Web geolocation precision is weaker than mobile GPS:** browser location can degrade geofence confidence and may increase out-of-bounds outcomes.
4. **Policy and data quality coupling:** attendance correctness is highly sensitive to `DIM_COURSE` and `DIM_CLASSROOM` quality.
5. **Current report snapshot is point-in-time:** counts and metering change as new attendance and warehouse activity occur.

## Future Work
1. **Accuracy hardening (priority):**
- Add timetable QA checks before class windows open.
- Add validation scripts for `DAY_OF_WEEK`, `START_TIME`, `END_TIME`, and `CLASS_ID` integrity.

2. **FinOps hardening:**
- Add scheduled FinOps extraction from Snowsight using a privileged role.
- Persist daily credits into an internal reporting table for dashboard display.

3. **Policy explainability:**
- Write reason-code detail columns (e.g., exact failed rule) to improve troubleshooting and user feedback.

4. **Telemetry and benchmarking:**
- Capture real-device T1-T5 metrics over larger samples (Wi-Fi vs mobile data) and publish monthly trend stats.

5. **Governance and rollout readiness:**
- Enable cohort-scale student seeding and strengthen enrollment verification workflow.
- Add automated checks that compare attendance outcomes to timetable/geofence expectations before release.
