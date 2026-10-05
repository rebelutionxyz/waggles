// WAGGLES_MESH_CORE1 — BLE GATT constants + frame codec for the mesh.
//
// One custom GATT service, one characteristic that carries a serialized
// MeshMessage frame. Every node exposes this service (peripheral role) AND
// scans/connects for it (central role) — the "dual role" the mesh needs.
//
// The codec is pure JS (no Buffer / btoa) so it runs identically under Node
// (tests) and React Native (device) with no polyfill. ble-plx reads/writes
// characteristic values as base64 strings.

import type { MeshMessage } from '../mesh/types';

/** Custom 128-bit service UUID for the Waggles mesh spike. */
export const MESH_SERVICE_UUID = 'b2e7d8a0-0001-4a7c-9c1a-a1b2c3d4e5f0';

/** Characteristic a central writes a frame to / subscribes for frames. */
export const MESH_FRAME_CHAR_UUID = 'b2e7d8a0-0002-4a7c-9c1a-a1b2c3d4e5f1';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8ToBytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function bytesToUtf8(bytes: number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp =
        ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const off = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return out;
}

function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]);
    const n1 = B64.indexOf(clean[i + 1]);
    const n2 = B64.indexOf(clean[i + 2]);
    const n3 = B64.indexOf(clean[i + 3]);
    bytes.push((n0 << 2) | (n1 >> 4));
    if (n2 >= 0) bytes.push(((n1 & 0x0f) << 4) | (n2 >> 2));
    if (n3 >= 0) bytes.push(((n2 & 0x03) << 6) | n3);
  }
  return bytes;
}

/** Serialize a frame for the wire (base64 of UTF-8 JSON). */
export function encodeFrame(msg: MeshMessage): string {
  return bytesToBase64(utf8ToBytes(JSON.stringify(msg)));
}

/** Parse a wire frame back into a MeshMessage, or null if malformed. */
export function decodeFrame(base64: string): MeshMessage | null {
  try {
    const obj = JSON.parse(bytesToUtf8(base64ToBytes(base64))) as Partial<MeshMessage>;
    if (
      typeof obj.id === 'string' &&
      typeof obj.origin === 'string' &&
      typeof obj.ttl === 'number' &&
      typeof obj.payload === 'string' &&
      Array.isArray(obj.seen)
    ) {
      return obj as MeshMessage;
    }
    return null;
  } catch {
    return null;
  }
}
