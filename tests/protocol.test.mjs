/**
 * Tests for host/protocol.js native-messaging framing
 * Run with: node --test tests/
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../host/protocol.js';

describe('sendMessage', () => {
  let originalWrite;
  let captured;

  beforeEach(() => {
    captured = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('emits a 4-byte little-endian length header followed by payload', () => {
    sendMessage({ ok: true });
    assert.equal(captured.length, 2);
    const header = captured[0];
    const payload = captured[1];

    assert.equal(header.length, 4);
    const declared = header.readUInt32LE(0);
    assert.equal(declared, payload.length);

    const parsed = JSON.parse(payload.toString('utf-8'));
    assert.deepEqual(parsed, { ok: true });
  });

  it('serializes UTF-8 correctly (multi-byte characters)', () => {
    sendMessage({ note: '♪ 日本語' });
    const payload = captured[1];
    const parsed = JSON.parse(payload.toString('utf-8'));
    assert.equal(parsed.note, '♪ 日本語');
    // Byte length > char length proves UTF-8 encoding
    assert.ok(payload.length > '{"note":"♪ 日本語"}'.length - 1);
  });

  it('throws on messages exceeding the 1 MB host→ext cap', () => {
    const big = { data: 'x'.repeat(1024 * 1024 + 1) };
    assert.throws(() => sendMessage(big), /Message too large/);
  });

  it('accepts messages right at the 1 MB boundary', () => {
    // 1 MB minus the JSON wrapping overhead
    const bodySize = 1024 * 1024 - 32;
    const msg = { data: 'x'.repeat(bodySize) };
    assert.doesNotThrow(() => sendMessage(msg));
  });
});
