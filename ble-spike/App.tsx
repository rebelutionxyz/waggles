import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type Permission,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { BleManager } from 'react-native-ble-plx';

import { MeshNode } from './src/mesh/transport';
import { BleTransport } from './src/ble/bleTransport';
import type { MeshMessage } from './src/mesh/types';

/**
 * WAGGLES_MESH_CORE1 — mesh test screen.
 *
 * Discovered peers, a Send box, and a live log of SENT / RECV / RELAYED / DROP.
 * On Android this drives the real ble-plx CENTRAL role; the PERIPHERAL role
 * (so other nodes can find THIS one) needs a companion module — see
 * src/ble/bleTransport.ts. Relay logic itself is unit-tested (npm test).
 */

const NODE_ID = `n-${Math.random().toString(36).slice(2, 7)}`;

function newMessageId(): string {
  return `${NODE_ID}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms: Permission[] =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export default function App() {
  const transportRef = useRef<BleTransport | null>(null);
  const nodeRef = useRef<MeshNode | null>(null);
  const managerRef = useRef<BleManager | null>(null);

  const [peers, setPeers] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const addLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    const manager = new BleManager();
    managerRef.current = manager;

    const transport = new BleTransport(manager, NODE_ID, {
      onPeerFound: (id) => setPeers((p) => (p.includes(id) ? p : [...p, id])),
      onPeerLost: (id) => setPeers((p) => p.filter((x) => x !== id)),
      onLog: addLog,
    });
    transportRef.current = transport;

    nodeRef.current = new MeshNode(
      transport,
      (msg: MeshMessage) => addLog(`DELIVER ${msg.id} "${msg.payload}" (from ${msg.origin})`),
      addLog,
    );

    (async () => {
      const ok = await requestBlePermissions();
      addLog(ok ? 'permissions granted' : 'permissions DENIED');
      transport.startPeripheral(); // logs the ble-plx peripheral-role limitation
      transport.startScanning();
      addLog(`scanning as ${NODE_ID}`);
    })();

    return () => {
      transport.destroy();
      manager.destroy();
    };
  }, [addLog]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !nodeRef.current) return;
    nodeRef.current.send(text, newMessageId());
    setDraft('');
  }, [draft]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Waggles Mesh</Text>
      <Text style={styles.subtitle}>node {NODE_ID} · BLE store-and-forward</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Peers ({peers.length})</Text>
        <Text style={styles.peers}>{peers.length ? peers.join(', ') : 'none in range'}</Text>
      </View>

      <View style={styles.sendRow}>
        <TextInput
          style={styles.input}
          placeholder="message…"
          placeholderTextColor="#6b6b74"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={styles.button} onPress={send}>
          <Text style={styles.buttonText}>Send</Text>
        </Pressable>
      </View>

      <Text style={styles.logHeader}>Live log</Text>
      <FlatList
        style={styles.logList}
        data={log}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <Text style={styles.logLine}>{item}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', paddingTop: 56, paddingHorizontal: 16, gap: 10 },
  title: { color: '#f5c518', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#8a8a94', fontSize: 13 },
  row: { backgroundColor: '#17171f', borderRadius: 10, padding: 12, gap: 4 },
  label: { color: '#8a8a94', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  peers: { color: '#fff', fontSize: 14 },
  sendRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#17171f',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
  },
  button: { backgroundColor: '#f5c518', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  buttonText: { color: '#0b0b0f', fontSize: 16, fontWeight: '700' },
  logHeader: { color: '#8a8a94', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  logList: { flex: 1, backgroundColor: '#101016', borderRadius: 10, padding: 10 },
  logLine: { color: '#cfcfd6', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, marginBottom: 2 },
});
