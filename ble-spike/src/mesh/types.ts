// WAGGLES_MESH_CORE1 — mesh wire model.
//
// Deliberately protocol-SIMPLE and legible: a proof, not the final wire format.
// Modelled on the public BLE-mesh store-and-forward concept (ttl + dedup +
// gossip re-broadcast). No bitchat code is pulled in.

/** A single mesh message as it travels hop to hop. */
export interface MeshMessage {
  /** Globally-unique message id. The dedup key. */
  id: string;
  /** Node id that originated the message. */
  origin: string;
  /** Hops remaining. Decremented on each relay; 0 means do not re-broadcast. */
  ttl: number;
  /** Opaque application payload (UTF-8 text for the spike). */
  payload: string;
  /**
   * Node ids that have already handled this message. Used so a relay never
   * sends a message back to a node that is known to already have it. Dedup
   * does the heavy lifting; `seen` is a cheap extra floor on redundant sends.
   */
  seen: string[];
}

/** Default hop limit — enough for A -> B -> C with headroom. */
export const DEFAULT_TTL = 5;

/** Bounded dedup cache size. Oldest ids evict first (FIFO). */
export const DEFAULT_SEEN_CACHE = 512;
