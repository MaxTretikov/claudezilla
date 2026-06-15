/**
 * Tests for host/ipc.js path validation
 * Run with: node --test tests/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath, isWindows } from '../host/ipc.js';

describe('validatePath', () => {
  it('accepts a plain absolute Unix path', () => {
    assert.equal(validatePath('/tmp/claudezilla.sock'), true);
  });

  it('rejects empty string', () => {
    assert.throws(() => validatePath(''), /empty or invalid/);
  });

  it('rejects null and undefined', () => {
    assert.throws(() => validatePath(null), /empty or invalid/);
    assert.throws(() => validatePath(undefined), /empty or invalid/);
  });

  it('rejects non-string types', () => {
    assert.throws(() => validatePath(42), /empty or invalid/);
    assert.throws(() => validatePath({}), /empty or invalid/);
  });

  it('rejects null-byte injection', () => {
    assert.throws(() => validatePath('/tmp/foo\0bar'), /null byte/);
  });

  it('rejects path traversal sequences', () => {
    assert.throws(() => validatePath('/tmp/../etc/passwd'), /path traversal/);
    assert.throws(() => validatePath('..'), /path traversal/);
  });

  it('includes the context string in error messages', () => {
    assert.throws(
      () => validatePath('/foo\0', 'auth token'),
      /auth token contains null byte/,
    );
  });

  if (!isWindows()) {
    it('accepts double-slash prefixes on Unix (only blocked on Windows)', () => {
      assert.equal(validatePath('//tmp/sock'), true);
    });
  }
});
