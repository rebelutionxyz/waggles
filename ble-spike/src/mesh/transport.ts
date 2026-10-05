// WAGGLES_MESH_CORE1 — transport abstraction + an in-memory network.
//
// The MeshEngine is transport-agnostic. A Transport moves opaque frames to/from
// peers. On a phone that is BLE (src/ble/bleTransport.ts); in tests it is the
// InMemoryNetwork below, which lets us wire up A/B/C with a defined topology and
// prove A -> B -> C store-and-forward with no hardware.

import { MeshEngine } from './engine';
import type { MeshMessage } from './types';

export type FrameHandler = (msg: MeshMessage, fromPeerId: string) => void;

/** Moves frames between this node and its peers. */
export interface Transport {
  readonly nodeId: string;
  /** Currently reachable peer ids (direct BLE range, or test topology). */
  peerIds(): string[];
  /** Send a frame to a specific peer. */
  sendTo(peerId: string, msg: MeshMessage): void;
  /** Register the handler invoked when a frame arrives from a peer. */
  onFrame(handler: FrameHandler): void;
}

/**
 * A node = engine + transport + a local delivery sink. Glue that turns an
 * inbound frame into: local delivery (if new) and relay to eligible peers.
 */
export class MeshNode {
  readonly engine: MeshEngine;
  constructor(
    readonly transport: Transport,
    private readonly onDeliver: (msg: MeshMessage) => void,
    private readonly log?: (line: string) => void,
  ) {
    this.engine = new MeshEngine({ nodeId: transport.nodeId });
    transport.onFrame((msg) => this.handleInbound(msg));
  }

  /** Originate a message from this node and broadcast it to all peers. */
  send(payload: string, id: string): MeshMessage {
    const msg = this.engine.originate(payload, id);
    this.log?.(`[${this.transport.nodeId}] SEND ${id} "${payload}"`);
    this.onDeliver(msg); // local echo
    for (const p of this.transport.peerIds()) this.transport.sendTo(p, msg);
    return msg;
  }

  private handleInbound(msg: MeshMessage): void {
    const d = this.engine.onReceive(msg);
    const nid = this.transport.nodeId;
    if (d.reason === 'duplicate') {
      this.log?.(`[${nid}] DROP-DUP ${msg.id}`);
      return;
    }
    if (d.deliverLocally) {
      this.log?.(`[${nid}] RECV ${msg.id} "${msg.payload}" (from ${msg.origin})`);
      this.onDeliver(msg);
    }
    if (d.rebroadcast) {
      const targets = this.engine.relayTargets(d.rebroadcast, this.transport.peerIds());
      for (const p of targets) {
        this.log?.(`[${nid}] RELAY ${msg.id} ${msg.origin}->${p} ttl=${d.rebroadcast.ttl}`);
        this.transport.sendTo(p, d.rebroadcast);
      }
    } else if (d.reason === 'ttl-expired') {
      this.log?.(`[${nid}] TTL-STOP ${msg.id}`);
    }
  }
}

/**
 * Deterministic in-memory mesh for tests. Links are declared explicitly so A
 * and C can be made NOT directly reachable (both only linked to B), exactly the
 * physical test topology. Delivery is synchronous.
 */
export class InMemoryNetwork {
  private readonly handlers = new Map<string, FrameHandler>();
  private readonly links = new Map<string, Set<string>>();

  node(nodeId: string): Transport {
    if (!this.links.has(nodeId)) this.links.set(nodeId, new Set());
    const net = this;
    return {
      nodeId,
      peerIds: () => [...(net.links.get(nodeId) ?? [])],
      sendTo: (peerId, msg) => net.deliver(nodeId, peerId, msg),
      onFrame: (handler) => net.handlers.set(nodeId, handler),
    };
  }

  /** Create a bidirectional BLE-range link between two nodes. */
  link(a: string, b: string): void {
    if (!this.links.has(a)) this.links.set(a, new Set());
    if (!this.links.has(b)) this.links.set(b, new Set());
    this.links.get(a)!.add(b);
    this.links.get(b)!.add(a);
  }

  /** Sever a node from the mesh (simulates powering B off). */
  unlinkAll(nodeId: string): void {
    for (const peers of this.links.values()) peers.delete(nodeId);
    this.links.set(nodeId, new Set());
  }

  private deliver(from: string, to: string, msg: MeshMessage): void {
    if (!this.links.get(from)?.has(to)) return; // out of range — dropped on the air
    const handler = this.handlers.get(to);
    if (handler) handler(msg, from);
  }
}
