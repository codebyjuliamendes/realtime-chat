import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClientFrame } from '../../server/domain/protocol.js';

const limits = { messageMaxLength: 10 };
const id = '3f0b8a5e-8a8e-4f7a-9d3c-1d2e3f4a5b6c';
const parse = (frame) => parseClientFrame(typeof frame === 'string' ? frame : JSON.stringify(frame), limits);

describe('parseClientFrame', () => {
  it('rejects non-JSON and malformed envelopes', () => {
    assert.equal(parse('{oops').ok, false);
    assert.equal(parse('[]').ok, false);
    assert.equal(parse({ type: 'message' }).ok, false);
    assert.equal(parse({ type: 1, payload: {} }).ok, false);
    assert.equal(parse({ type: 'nope', payload: {} }).ok, false);
  });
  it('parses a valid message and normalizes content', () => {
    const result = parse({ type: 'message', payload: { id: id.toUpperCase(), channelId: 'general', content: ' hi ' } });
    assert.deepEqual(result, { ok: true, command: { type: 'message', id, channelId: 'general', content: 'hi' } });
  });
  it('returns the message id as ref when content is invalid', () => {
    const result = parse({ type: 'message', payload: { id, channelId: 'general', content: 'x'.repeat(11) } });
    assert.equal(result.ok, false);
    assert.equal(result.ref, id);
  });
  it('validates channel ids for room commands', () => {
    assert.equal(parse({ type: 'join', payload: { channelId: 'general' } }).ok, true);
    assert.equal(parse({ type: 'join', payload: { channelId: '<script>' } }).ok, false);
    assert.equal(parse({ type: 'typing', payload: {} }).ok, false);
  });
  it('requires a token for auth', () => {
    assert.equal(parse({ type: 'auth', payload: { userId: 'x', username: 'y' } }).ok, false);
    assert.equal(parse({ type: 'auth', payload: { token: 't' } }).ok, true);
  });
});
