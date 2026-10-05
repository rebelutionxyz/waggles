// WAGGLES_MESH_CORE1 — relay logic unit tests.
//
// Pure, no hardware. Runs under Node's built-in test runner (Node >= 23 strips
// TS types natively):  node --test src/mesh/*.test.ts
//
// Covers: dedup, ttl decrement, ttl-expiry stops relay, bounded seen-cache
// eviction, and the headline A -> B -> C store-and-forward with A and C NOT in
// direct range, plus "kill B -> C stops receiving".

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MeshEngine, SeenCache } from './engine';
import { InMemoryNetwork, MeshNode } from './transport';
import type { MeshMessage } from './types';
import { decodeFrame, encodeFrame } from '../ble/protocol';

test('frame codec round-trips (incl. unicode payload)', () => {
  const msg: MeshMessage = { id: 'm-🐝', origin: 'A', ttl: 5, payload: 'héllo 🐝 mesh', seen: ['A'] };
  const wire = encodeFrame(msg);
  const back = decodeFrame(wire);
  assert.deepEqual(back, msg);
});

test('frame codec rejects malformed input', () => {
  assert.equal(decodeFrame('not+valid+json'), null);
  assert.equal(decodeFrame(encodeFrame({ id: 'x' } as unknown as MeshMessage)), null);
});

test('SeenCache dedups and is bounded (FIFO eviction)', () => {
  const c = new SeenCache(3);
  assert.equal(c.add('a'), true);
  assert.equal(c.add('a'), false); // dup
  c.add('b');
  c.add('c');
  assert.equal(c.size, 3);
  c.add('d'); // evicts 'a'
  assert.equal(c.size, 3);
  assert.equal(c.has('a'), false);
  assert.equal(c.has('d'), true);
});

test('engine: duplicate id is dropped, no local delivery, no relay', () => {
  const e = new MeshEngine({ nodeId: 'B' });
  const msg: MeshMessage = { id: 'm1', origin: 'A', ttl: 5, payload: 'hi', seen: ['A'] };
  const first = e.onReceive(msg);
  assert.equal(first.deliverLocally, true);
  assert.equal(first.reason, 'delivered-and-relayed');
  const second = e.onReceive(msg);
  assert.equal(second.deliverLocally, false);
  assert.equal(second.rebroadcast, null);
  assert.equal(second.reason, 'duplicate');
});

test('engine: ttl decrements on relay', () => {
  const e = new MeshEngine({ nodeId: 'B' });
  const msg: MeshMessage = { id: 'm2', origin: 'A', ttl: 5, payload: 'x', seen: ['A'] };
  const d = e.onReceive(msg);
  assert.equal(d.rebroadcast?.ttl, 4);
  assert.ok(d.rebroadcast?.seen.includes('B'));
});

test('engine: ttl expiry delivers locally but does NOT relay', () => {
  const e = new MeshEngine({ nodeId: 'C' });
  const msg: MeshMessage = { id: 'm3', origin: 'A', ttl: 1, payload: 'x', seen: ['A', 'B'] };
  const d = e.onReceive(msg);
  assert.equal(d.deliverLocally, true);
  assert.equal(d.rebroadcast, null);
  assert.equal(d.reason, 'ttl-expired');
});

test('engine: relayTargets excludes self and already-seen peers', () => {
  const e = new MeshEngine({ nodeId: 'B' });
  const msg: MeshMessage = { id: 'm4', origin: 'A', ttl: 4, payload: 'x', seen: ['A', 'B'] };
  assert.deepEqual(e.relayTargets(msg, ['A', 'B', 'C', 'D']), ['C', 'D']);
});

test('A -> B -> C store-and-forward (A and C NOT in direct range)', () => {
  const net = new InMemoryNetwork();
  const delivered: Record<string, string[]> = { A: [], B: [], C: [] };
  const log: string[] = [];

  const A = new MeshNode(net.node('A'), (m) => delivered.A.push(m.payload), (l) => log.push(l));
  const B = new MeshNode(net.node('B'), (m) => delivered.B.push(m.payload), (l) => log.push(l));
  const C = new MeshNode(net.node('C'), (m) => delivered.C.push(m.payload), (l) => log.push(l));
  void B; void C;

  // Topology: A--B--C. A and C share no link.
  net.link('A', 'B');
  net.link('B', 'C');

  A.send('hello-C', 'msg-1');

  // C received it, relayed by B, even though A and C are not directly linked.
  assert.deepEqual(delivered.C, ['hello-C'], 'C should receive via B');
  assert.deepEqual(delivered.B, ['hello-C'], 'B should receive and relay');
  assert.ok(log.some((l) => l.includes('RELAY') && l.includes('A->C')), 'B logs a relay A->C');
});

test('no infinite loop in a triangle (A-B-C all linked)', () => {
  const net = new InMemoryNetwork();
  const count: Record<string, number> = { A: 0, B: 0, C: 0 };
  const A = new MeshNode(net.node('A'), () => (count.A += 1));
  const B = new MeshNode(net.node('B'), () => (count.B += 1));
  const C = new MeshNode(net.node('C'), () => (count.C += 1));
  void A; void B; void C;
  net.link('A', 'B');
  net.link('B', 'C');
  net.link('A', 'C');

  A.send('x', 'msg-loop');

  // Each node delivers exactly once despite the cycle (dedup holds).
  assert.equal(count.A, 1);
  assert.equal(count.B, 1);
  assert.equal(count.C, 1);
});

test('kill B: C stops receiving from A', () => {
  const net = new InMemoryNetwork();
  const deliveredC: string[] = [];
  const A = new MeshNode(net.node('A'), () => {});
  const B = new MeshNode(net.node('B'), () => {});
  const C = new MeshNode(net.node('C'), (m) => deliveredC.push(m.payload));
  void A; void B; void C;
  net.link('A', 'B');
  net.link('B', 'C');

  net.unlinkAll('B'); // power B off
  A.send('after-B-dead', 'msg-2');

  assert.deepEqual(deliveredC, [], 'with B gone, C hears nothing');
});
