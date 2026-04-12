import pandas as pd
import streamlit as st
import plotly.express as px

try:
  from snowflake.snowpark.context import get_active_session
except Exception:
  get_active_session = None

st.set_page_config(page_title="Attendance Admin Dashboard", layout="wide")
st.title("JKUAT Attendance Admin Dashboard v2")

STATUS_COLORS = {
    "PRESENT": "#2E7D32",
    "PROXY-BLOCKED": "#C62828",
    "ABSENT-OUT-OF-BOUNDS": "#EF6C00",
    "WRONG-TIME-OR-DAY": "#8E24AA",
}


def get_session():
  active_session_fn = get_active_session
  if active_session_fn is None:
    st.error("Snowflake active session API is unavailable. Run this app in Snowsight Streamlit.")
    st.stop()

  try:
    return active_session_fn()  # pyright: ignore[reportOptionalCall]
  except Exception as exc:
    st.error(f"Failed to get active Snowflake session: {exc}")
    st.stop()


def run_query(session, sql):
    return session.sql(sql).to_pandas()


@st.cache_data(ttl=60)
def load_attendance(_session):
    return run_query(
        session,
        """
        WITH COURSE_LATEST AS (
          SELECT
            COURSE_ID,
            COURSE_TITLE,
            CLASS_ID,
            DAY_OF_WEEK,
            START_TIME,
            END_TIME,
            ROW_NUMBER() OVER (PARTITION BY COURSE_ID ORDER BY CREATED_AT DESC) RN
          FROM ATTENDANCE_DB.CORE.DIM_COURSE
        )
        SELECT
          F.ATTENDANCE_ID,
          F.STUDENT_ID,
          F.COURSE_ID,
          COALESCE(CL.COURSE_TITLE, F.COURSE_ID) AS COURSE_TITLE,
          F.CLASS_ID,
          C.BUILDING_NAME,
          C.ROOM_NUMBER,
          F.STATUS,
          TO_VARCHAR(F.CHECK_IN_TIME, 'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME_EAT,
          ST_X(F.DEVICE_LOCATION) AS LONGITUDE,
          ST_Y(F.DEVICE_LOCATION) AS LATITUDE,
          CL.DAY_OF_WEEK,
          CL.START_TIME,
          CL.END_TIME
        FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE F
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM C ON C.CLASS_ID = F.CLASS_ID
        LEFT JOIN COURSE_LATEST CL ON CL.COURSE_ID = F.COURSE_ID AND CL.RN = 1
        ORDER BY F.CHECK_IN_TIME DESC
        LIMIT 200
        """,
    )


@st.cache_data(ttl=60)
def load_audit(_session):
    return run_query(
        session,
        """
        WITH COURSE_LATEST AS (
          SELECT
            COURSE_ID,
            CLASS_ID,
            DAY_OF_WEEK,
            START_TIME,
            END_TIME,
            ROW_NUMBER() OVER (PARTITION BY COURSE_ID ORDER BY CREATED_AT DESC) RN
          FROM ATTENDANCE_DB.CORE.DIM_COURSE
        ),
        X AS (
          SELECT
            F.ATTENDANCE_ID,
            F.STUDENT_ID,
            F.COURSE_ID,
            F.CLASS_ID AS RECORDED_CLASS_ID,
            CL.CLASS_ID AS EXPECTED_CLASS_ID,
            F.STATUS,
            TO_VARCHAR(F.CHECK_IN_TIME, 'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME_EAT,
            CASE DAYOFWEEKISO(F.CHECK_IN_TIME)
              WHEN 1 THEN 'MONDAY'
              WHEN 2 THEN 'TUESDAY'
              WHEN 3 THEN 'WEDNESDAY'
              WHEN 4 THEN 'THURSDAY'
              WHEN 5 THEN 'FRIDAY'
              WHEN 6 THEN 'SATURDAY'
              WHEN 7 THEN 'SUNDAY'
            END AS CHECKIN_DAY,
            CL.DAY_OF_WEEK AS EXPECTED_DAY,
            CL.START_TIME,
            CL.END_TIME,
            TO_VARCHAR(TO_TIME(F.CHECK_IN_TIME), 'HH24:MI') AS CHECKIN_CLOCK
          FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE F
          LEFT JOIN COURSE_LATEST CL ON CL.COURSE_ID = F.COURSE_ID AND CL.RN = 1
        )
        SELECT
          *,
          CASE
            WHEN EXPECTED_CLASS_ID IS NULL THEN 'NO_TIMETABLE'
            WHEN RECORDED_CLASS_ID = EXPECTED_CLASS_ID THEN 'OK'
            ELSE 'MISMATCH'
          END AS PLACE_CHECK,
          CASE
            WHEN EXPECTED_DAY IS NULL OR START_TIME IS NULL OR END_TIME IS NULL THEN 'NO_TIMETABLE'
            WHEN CHECKIN_DAY <> EXPECTED_DAY THEN 'WRONG_DAY'
            WHEN TO_TIME(CHECKIN_CLOCK) BETWEEN TO_TIME(START_TIME) AND TO_TIME(END_TIME) THEN 'ON_TIME_WINDOW'
            ELSE 'OUTSIDE_TIME_WINDOW'
          END AS TIME_CHECK
        FROM X
        ORDER BY CHECK_IN_TIME_EAT DESC
        LIMIT 500
        """,
    )


@st.cache_data(ttl=60)
def load_timetable(_session):
    return run_query(
        session,
        """
        SELECT
          D.COURSE_ID,
          D.COURSE_TITLE,
          D.LECTURER_NAME,
          D.DAY_OF_WEEK,
          D.START_TIME,
          D.END_TIME,
          D.CLASS_ID,
          C.BUILDING_NAME,
          C.ROOM_NUMBER
        FROM ATTENDANCE_DB.CORE.DIM_COURSE D
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM C ON C.CLASS_ID = D.CLASS_ID
        ORDER BY
          CASE D.DAY_OF_WEEK
            WHEN 'MONDAY' THEN 1
            WHEN 'TUESDAY' THEN 2
            WHEN 'WEDNESDAY' THEN 3
            WHEN 'THURSDAY' THEN 4
            WHEN 'FRIDAY' THEN 5
            ELSE 6
          END,
          D.START_TIME,
          D.COURSE_ID
        """,
    )


session = get_session()

tab1, tab2, tab3 = st.tabs(["Attendance Live", "Audit", "Geofence + Timetable"])

with tab1:
    df = load_attendance(session)
    if df.empty:
        st.info("No attendance records yet.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Total", len(df))
        c2.metric("Present", int((df["STATUS"] == "PRESENT").sum()))
        c3.metric("Proxy Blocked", int((df["STATUS"] == "PROXY-BLOCKED").sum()))
        c4.metric("⏰ Wrong Time/Day", int((df["STATUS"] == "WRONG-TIME-OR-DAY").sum()))

        st.dataframe(df, use_container_width=True)

        map_df = df.dropna(subset=["LATITUDE", "LONGITUDE"]).copy()
        if not map_df.empty:
            map_df["COLOR"] = map_df["STATUS"].map(STATUS_COLORS).fillna("#607D8B")
            fig = px.scatter_map(
                map_df,
                lat="LATITUDE",
                lon="LONGITUDE",
                color="STATUS",
                hover_data=["STUDENT_ID", "COURSE_ID", "CHECK_IN_TIME_EAT", "BUILDING_NAME"],
                zoom=14,
                height=450,
                color_discrete_map=STATUS_COLORS,
            )
            st.plotly_chart(fig, use_container_width=True)

with tab2:
    audit_df = load_audit(session)
    if audit_df.empty:
        st.info("No audit rows found.")
    else:
        st.subheader("Audit Details")
        st.dataframe(audit_df, use_container_width=True)

        summary = (
            audit_df.groupby(["PLACE_CHECK", "TIME_CHECK"]).size().reset_index(name="COUNT")
        )
        st.subheader("Violation Breakdown")
        fig = px.bar(summary, x="TIME_CHECK", y="COUNT", color="PLACE_CHECK", barmode="group")
        st.plotly_chart(fig, use_container_width=True)

        st.download_button(
            label="Download Report (CSV)",
            data=audit_df.to_csv(index=False),
            file_name="attendance_audit_report.csv",
            mime="text/csv",
        )

with tab3:
    timetable_df = load_timetable(session)
    st.subheader("MCS 4.2 Timetable")
    st.dataframe(timetable_df, use_container_width=True)

    geofence_df = run_query(
        session,
        """
        SELECT
          CLASS_ID,
          BUILDING_NAME,
          ROOM_NUMBER,
          ROUND(ST_AREA(GEOFENCE_POLYGON), 1) AS AREA_SQ_M,
          ST_NPOINTS(GEOFENCE_POLYGON) AS NODES
        FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
        ORDER BY CLASS_ID
        """,
    )
    st.subheader("Geofence Inventory")
    st.dataframe(geofence_df, use_container_width=True)
