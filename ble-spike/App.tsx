import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type Permission,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { BleManager, State, type Subscription } from 'react-native-ble-plx';

/**
 * WAGGLES_SCAFFOLD1 — throwaway BLE proving ground.
 *
 * Trivial single screen: boots a BleManager, fires the runtime Bluetooth
 * permission prompt (Android), and renders the live BLE adapter state.
 * NO mesh, NO scan loop, NO TALK/COMMS wiring — that is WAGGLES_MESH_CORE1.
 */

type PermStatus = 'unknown' | 'requesting' | 'granted' | 'denied' | 'not-required';

const ANDROID_31_PERMS: Permission[] = [
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
];

async function requestBlePermissions(): Promise<PermStatus> {
  if (Platform.OS !== 'android') {
    // iOS prompts automatically on first BLE use via the Info.plist strings.
    return 'not-required';
  }

  // BLUETOOTH_SCAN / _CONNECT / _ADVERTISE exist from Android 12 (API 31).
  // On older devices ACCESS_FINE_LOCATION alone gates BLE scanning.
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms: Permission[] =
    apiLevel >= 31 ? ANDROID_31_PERMS : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(perms);
  const allGranted = perms.every(
    (p) => results[p] === PermissionsAndroid.RESULTS.GRANTED,
  );
  return allGranted ? 'granted' : 'denied';
}

function labelForState(state: State): string {
  switch (state) {
    case State.PoweredOn:
      return 'Powered on — ready';
    case State.PoweredOff:
      return 'Powered off — turn Bluetooth on';
    case State.Unauthorized:
      return 'Unauthorized — grant Bluetooth permission';
    case State.Unsupported:
      return 'Unsupported on this device';
    case State.Resetting:
      return 'Resetting…';
    case State.Unknown:
    default:
      return 'Unknown';
  }
}

export default function App() {
  const managerRef = useRef<BleManager | null>(null);
  const [adapterState, setAdapterState] = useState<State>(State.Unknown);
  const [permStatus, setPermStatus] = useState<PermStatus>('unknown');

  useEffect(() => {
    const manager = new BleManager();
    managerRef.current = manager;

    let sub: Subscription | undefined;

    (async () => {
      setPermStatus('requesting');
      const status = await requestBlePermissions();
      setPermStatus(status);

      // emitCurrentState=true pushes the current state immediately.
      sub = manager.onStateChange((s) => setAdapterState(s), true);
    })();

    return () => {
      sub?.remove();
      manager.destroy();
      managerRef.current = null;
    };
  }, []);

  const reRequest = useCallback(async () => {
    setPermStatus('requesting');
    setPermStatus(await requestBlePermissions());
    const current = await managerRef.current?.state();
    if (current) setAdapterState(current);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Waggles BLE Spike</Text>
      <Text style={styles.subtitle}>mesh proving ground · no networking yet</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Adapter state</Text>
        <Text style={styles.value}>{labelForState(adapterState)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Permissions</Text>
        <Text style={styles.value}>{permStatus}</Text>
      </View>

      <Pressable style={styles.button} onPress={reRequest}>
        <Text style={styles.buttonText}>Re-request permission</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    color: '#f5c518',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8a8a94',
    fontSize: 14,
    marginBottom: 12,
  },
  card: {
    width: '100%',
    backgroundColor: '#17171f',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  label: {
    color: '#8a8a94',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  button: {
    marginTop: 8,
    backgroundColor: '#f5c518',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  buttonText: {
    color: '#0b0b0f',
    fontSize: 16,
    fontWeight: '700',
  },
});
