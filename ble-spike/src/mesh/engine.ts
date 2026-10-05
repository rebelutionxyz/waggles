// WAGGLES_MESH_CORE1 — the relay engine.
//
// Pure, transport-agnostic store-and-forward logic. No react-native, no BLE,
// no timers — everything here is synchronous and unit-testable on a laptop.
// The BLE transport (src/ble/bleTransport.ts) drives it; so does the in-memory
// test network (src/mesh/transport.ts).

import {
  DEFAULT_SEEN_CACHE,
  DEFAULT_TTL,
  type MeshMessage,
} from './types';

/** A bounded FIFO set of ids — the dedup / seen cache. */
export class SeenCache {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();

  constructor(private readonly max: number = DEFAULT_SEEN_CACHE) {
    if (max < 1) throw new Error('SeenCache max must be >= 1');
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  /** Record an id. Returns true if it was newly added, false if already present. */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.max) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
    return true;
  }

  get size(): number {
    return this.set.size;
  }
}

/** What the engine decided to do with an inbound frame. */
export interface RelayDecision {
  /** Deliver to the local application layer (first time we have seen it). */
  deliverLocally: boolean;
  /** The frame to re-broadcast to peers, or null if it should not be relayed. */
  rebroadcast: MeshMessage | null;
  /** Why — for the live log / tests. */
  reason:
    | 'duplicate'
    | 'ttl-expired'
    | 'delivered-and-relayed'
    | 'delivered-no-relay';
}

export interface MeshEngineOptions {
  nodeId: string;
  seenCacheSize?: number;
  defaultTtl?: number;
}

/**
 * The mesh engine for ONE node. Feed it inbound frames with `onReceive`; it
 * tells you whether to deliver locally and what (if anything) to re-broadcast.
 * Create new originating frames with `originate`.
 */
export class MeshEngine {
  readonly nodeId: string;
  private readonly seen: SeenCache;
  private readonly defaultTtl: number;

  constructor(opts: MeshEngineOptions) {
    this.nodeId = opts.nodeId;
    this.seen = new SeenCache(opts.seenCacheSize ?? DEFAULT_SEEN_CACHE);
    this.defaultTtl = opts.defaultTtl ?? DEFAULT_TTL;
  }

  /** Build a fresh message originating from this node. */
  originate(payload: string, id: string, ttl: number = this.defaultTtl): MeshMessage {
    const msg: MeshMessage = {
      id,
      origin: this.nodeId,
      ttl,
      payload,
      seen: [this.nodeId],
    };
    // Mark our own id so it never loops back to us.
    this.seen.add(id);
    return msg;
  }

  /**
   * Process an inbound frame. Pure decision — performs no I/O. The caller
   * sends `decision.rebroadcast` to its peers (minus those in `seen`).
   */
  onReceive(msg: MeshMessage): RelayDecision {
    // 1. Dedup: if we have handled this id, drop it outright (loop/flood guard).
    if (this.seen.has(msg.id)) {
      return { deliverLocally: false, rebroadcast: null, reason: 'duplicate' };
    }
    this.seen.add(msg.id);

    // 2. First sight -> deliver locally.
    // 3. Store-and-forward: decrement ttl; relay only if hops remain.
    const nextTtl = msg.ttl - 1;
    if (nextTtl <= 0) {
      return { deliverLocally: true, rebroadcast: null, reason: 'ttl-expired' };
    }

    const seen = msg.seen.includes(this.nodeId)
      ? msg.seen
      : [...msg.seen, this.nodeId];

    const rebroadcast: MeshMessage = { ...msg, ttl: nextTtl, seen };
    return {
      deliverLocally: true,
      rebroadcast,
      reason: 'delivered-and-relayed',
    };
  }

  /** Peers eligible to receive a relay — excludes any already in `seen`. */
  relayTargets(msg: MeshMessage, peerIds: readonly string[]): string[] {
    return peerIds.filter((p) => p !== this.nodeId && !msg.seen.includes(p));
  }

  get seenCount(): number {
    return this.seen.size;
  }
}
