import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

const hashText = (input) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildSoftDeviceHash = () => {
    const parts = [
        Device.brand,
        Device.manufacturer,
        Device.modelName,
        Device.modelId,
        Device.osName,
        Device.osVersion,
        Device.osBuildId,
        Device.osInternalBuildId,
        Device.deviceName,
    ]
        .filter(Boolean)
        .map(value => String(value));

    if (!parts.length) {
        return null;
    }

    return `soft-${hashText(parts.join('|'))}`;
};

export const getDeviceHash = async () => {
    // For web testing, return the device ID we inserted in Snowflake
    // For mobile this would use actual device APIs
    if (Platform.OS === 'web') {
        // Running in web browser
        return 'web-device-qhxql1agd';
    }

    // Running on mobile device
    const directId = [
        Application.androidId,
        Device.osInternalBuildId,
        Device.osBuildId,
    ]
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .find(value => value.length > 0);

    if (directId) {
        return directId;
    }

    const softHash = buildSoftDeviceHash();
    if (softHash) {
        return softHash;
    }

    return 'soft-generic-device';
};