import sodium from 'react-native-libsodium';

/**
 * libsodium, initialized once.
 *
 * react-native-libsodium is the NATIVE binding of the very same libsodium that
 * the web comms core (`TheMANUAL.tech/src/lib/e2ee.ts`) loads as
 * `libsodium-wrappers-sumo`. Same primitives, same wire format — so a content
 * key sealed here (crypto_box_seal / X25519) and a body encrypted here
 * (XChaCha20-Poly1305, `e2ee:v1:` framing) are byte-for-byte interoperable with
 * the web client. We MOUNT this core; we never fork the crypto.
 *
 * Hermes (React Native's engine) has no WebAssembly, so the web's WASM sumo build
 * cannot run on device — this native binding is the reason the app needs a
 * dev-client build rather than plain Expo Go.
 */

let ready: Promise<typeof sodium> | null = null;

export function S(): Promise<typeof sodium> {
  if (!ready) {
    ready = Promise.resolve(sodium.ready).then(() => sodium);
  }
  return ready;
}

export type Sodium = typeof sodium;
