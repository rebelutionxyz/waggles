// WAGGLES_MESH_CORE1 — BLE transport (react-native-ble-plx).
//
// ┌─ IMPORTANT REAL-WORLD CONSTRAINT ───────────────────────────────────────┐
// │ react-native-ble-plx is CENTRAL-ONLY. It can scan, connect, read, write │
// │ and subscribe — but it CANNOT advertise or run a GATT server            │
// │ (peripheral role). It has no startAdvertising / addService API.         │
// │                                                                          │
// │ The mesh needs the DUAL role (each node both advertises a service AND    │
// │ scans for peers). The PERIPHERAL half therefore needs a companion native │
// │ module — e.g. `react-native-ble-advertiser` (advertise only) or a        │
// │ GATT-server module. On Expo that means an extra config-plugin/dev-client │
// │ rebuild. This file implements the CENTRAL half fully and leaves the      │
// │ peripheral half as a typed, documented seam (startPeripheral()).         │
// │                                                                          │
// │ iOS caveat: even with a peripheral module, iOS backgrounds + restricts   │
// │ the peripheral role heavily (service UUID moves to the overflow area,    │
// │ undiscoverable by other iOS centrals in background). Android is the      │
// │ reliable dual-role target — which is why the on-device test is Android.  │
// └──────────────────────────────────────────────────────────────────────┘

import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';

import type { MeshMessage } from '../mesh/types';
import type { FrameHandler, Transport } from '../mesh/transport';
import { MESH_FRAME_CHAR_UUID, MESH_SERVICE_UUID, decodeFrame, encodeFrame } from './protocol';

export interface BleTransportEvents {
  onPeerFound?: (id: string, name: string | null) => void;
  onPeerLost?: (id: string) => void;
  onLog?: (line: string) => void;
}

/**
 * Central-role BLE transport. Scans for the mesh service, connects to peers,
 * writes frames to their mesh characteristic, and subscribes for inbound
 * frames. The peripheral role (so OTHER centrals can find US) is the seam at
 * startPeripheral() — see the header.
 */
export class BleTransport implements Transport {
  readonly nodeId: string;
  private frameHandler: FrameHandler | null = null;
  private readonly peers = new Map<string, Device>();
  private readonly monitors = new Map<string, Subscription>();
  private scanning = false;

  constructor(
    private readonly manager: BleManager,
    nodeId: string,
    private readonly events: BleTransportEvents = {},
  ) {
    this.nodeId = nodeId;
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  /** Start scanning for mesh peers and wiring up inbound frame monitoring. */
  startScanning(): void {
    if (this.scanning) return;
    this.scanning = true;
    this.manager.startDeviceScan([MESH_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.events.onLog?.(`scan error: ${error.message}`);
        return;
      }
      if (device && !this.peers.has(device.id)) {
        void this.connectPeer(device);
      }
    });
  }

  stopScanning(): void {
    if (!this.scanning) return;
    this.manager.stopDeviceScan();
    this.scanning = false;
  }

  private async connectPeer(device: Device): Promise<void> {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.peers.set(connected.id, connected);
      this.events.onPeerFound?.(connected.id, connected.name ?? connected.localName ?? null);
      this.events.onLog?.(`peer connected: ${connected.id}`);

      // Subscribe for inbound frames this peer notifies to us.
      const sub = connected.monitorCharacteristicForService(
        MESH_SERVICE_UUID,
        MESH_FRAME_CHAR_UUID,
        (err, char) => {
          if (err) {
            this.events.onLog?.(`monitor error ${connected.id}: ${err.message}`);
            return;
          }
          if (char?.value) {
            const msg = decodeFrame(char.value);
            if (msg) this.frameHandler?.(msg, connected.id);
            else this.events.onLog?.(`bad frame from ${connected.id}`);
          }
        },
      );
      this.monitors.set(connected.id, sub);

      connected.onDisconnected(() => this.dropPeer(connected.id));
    } catch (e) {
      this.events.onLog?.(`connect failed ${device.id}: ${(e as Error).message}`);
    }
  }

  private dropPeer(id: string): void {
    this.monitors.get(id)?.remove();
    this.monitors.delete(id);
    this.peers.delete(id);
    this.events.onPeerLost?.(id);
  }

  /** Write a frame to one peer's mesh characteristic. */
  sendTo(peerId: string, msg: MeshMessage): void {
    const device = this.peers.get(peerId);
    if (!device) return;
    const value = encodeFrame(msg);
    void device
      .writeCharacteristicWithoutResponseForService(MESH_SERVICE_UUID, MESH_FRAME_CHAR_UUID, value)
      .catch((e: Error) => this.events.onLog?.(`write failed ${peerId}: ${e.message}`));
  }

  /**
   * PERIPHERAL SEAM — not implementable with ble-plx (central-only).
   * A companion module must advertise MESH_SERVICE_UUID and expose a GATT
   * server with MESH_FRAME_CHAR_UUID (write + notify) so other centrals can
   * discover and push frames to this node. Until then, two ble-plx-only nodes
   * cannot find each other; the engine + codec + central half are proven and
   * ready to drive once the peripheral module is added.
   */
  startPeripheral(): void {
    this.events.onLog?.(
      'PERIPHERAL role unavailable: ble-plx is central-only. Add react-native-ble-advertiser (or a GATT-server module) to advertise MESH_SERVICE_UUID + serve MESH_FRAME_CHAR_UUID.',
    );
  }

  destroy(): void {
    this.stopScanning();
    for (const sub of this.monitors.values()) sub.remove();
    this.monitors.clear();
    this.peers.clear();
  }
}
