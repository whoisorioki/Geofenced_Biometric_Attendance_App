import { executeSQL } from './snowflake.service';

let classroomCache = null;

const parseGeoJsonToMapCoords = (geoJsonStr) => {
    try {
        const geoJson = JSON.parse(geoJsonStr);
        const ring = geoJson.coordinates[0];
        return ring.slice(0, -1).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
    } catch (error) {
        console.warn('GeoJSON parse error:', error.message);
        return [];
    }
};

export const fetchAllClassrooms = async () => {
    if (classroomCache) {
        return classroomCache;
    }

    const result = await executeSQL(
        `SELECT
       CLASS_ID,
       BUILDING_NAME,
       ST_ASGEOJSON(GEOFENCE_POLYGON)        AS POLY_JSON,
       ST_Y(ST_CENTROID(GEOFENCE_POLYGON))   AS CENTER_LAT,
       ST_X(ST_CENTROID(GEOFENCE_POLYGON))   AS CENTER_LNG
     FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
     ORDER BY CLASS_ID`,
        {}
    );

    if (!result?.data?.length) {
        throw new Error('No classrooms found in DIM_CLASSROOM.');
    }

    classroomCache = result.data.map(([classId, buildingName, polyJson, centerLat, centerLng]) => ({
        classId,
        buildingName,
        polygon: parseGeoJsonToMapCoords(polyJson),
        center: {
            latitude: parseFloat(centerLat),
            longitude: parseFloat(centerLng),
        },
        geojsonStr: polyJson,
    }));

    return classroomCache;
};

export const isPointInPolygon = (point, polygon) => {
    if (!polygon || polygon.length < 3) {
        return false;
    }

    const { latitude: py, longitude: px } = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].longitude;
        const yi = polygon[i].latitude;
        const xj = polygon[j].longitude;
        const yj = polygon[j].latitude;
        const intersect =
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

        if (intersect) {
            inside = !inside;
        }
    }

    return inside;
};

export const distanceMetres = (lat1, lon1, lat2, lon2) => {
    const radius = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;

    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const detectClassroom = (userLocation, classrooms) => {
    if (!userLocation || !classrooms?.length) {
        return {
            detected: false,
            classroom: null,
            nearestClassroom: null,
        };
    }

    for (const room of classrooms) {
        if (room.polygon.length >= 3 && isPointInPolygon(userLocation, room.polygon)) {
            return {
                detected: true,
                classroom: room,
                nearestClassroom: null,
            };
        }
    }

    let nearest = null;
    let minDistance = Infinity;

    for (const room of classrooms) {
        const distance = distanceMetres(
            userLocation.latitude,
            userLocation.longitude,
            room.center.latitude,
            room.center.longitude
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearest = {
                ...room,
                distanceMetres: Math.round(distance),
            };
        }
    }

    return {
        detected: false,
        classroom: null,
        nearestClassroom: nearest,
    };
};
