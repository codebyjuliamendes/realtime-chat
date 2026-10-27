import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isChannelId,
  isMessageId,
  slugifyChannelName,
  validateChannelName,
  validateMessageContent,
  validateUsername,
} from '../../server/domain/validation.js';

describe('validateUsername', () => {
  it('trims and collapses whitespace', () => {
    assert.deepEqual(validateUsername('  Ana   Maria '), { ok: true, value: 'Ana Maria' });
  });
  it('rejects empty, non-string, too long and control characters', () => {
    assert.equal(validateUsername('   ').ok, false);
    assert.equal(validateUsername(42).ok, false);
    assert.equal(validateUsername('a'.repeat(33)).ok, false);
    assert.equal(validateUsername('ana\u0000').ok, false);
    assert.equal(validateUsername('ana‮evil').ok, false);
  });
  it('counts emoji as single characters', () => {
    assert.equal(validateUsername('😀'.repeat(32)).ok, true);
  });
  it('keeps HTML as plain text (escaping is the renderer job)', () => {
    assert.deepEqual(validateUsername('<b>x</b>'), { ok: true, value: '<b>x</b>' });
  });
});

describe('validateMessageContent', () => {
  it('accepts text up to the limit and allows newlines', () => {
    assert.deepEqual(validateMessageContent(' hi\nthere ', 10), { ok: true, value: 'hi\nthere' });
    assert.equal(validateMessageContent('x'.repeat(10), 10).ok, true);
  });
  it('rejects empty, oversized and non-string content', () => {
    assert.equal(validateMessageContent('   ', 10).ok, false);
    assert.equal(validateMessageContent('x'.repeat(11), 10).ok, false);
    assert.equal(validateMessageContent({ text: 'x' }, 10).ok, false);
    assert.equal(validateMessageContent('bell\u0007', 10).ok, false);
  });
});

describe('channels', () => {
  it('validates names and builds slugs', () => {
    assert.equal(validateChannelName('Random').ok, true);
    assert.equal(validateChannelName('').ok, false);
    assert.equal(validateChannelName('x'.repeat(41)).ok, false);
    assert.equal(slugifyChannelName('Café & Código!'), 'cafe-codigo');
    assert.equal(slugifyChannelName('🔥🔥'), null);
    assert.equal(slugifyChannelName('a'.repeat(39) + ' b').length <= 40, true);
  });
  it('recognizes channel ids', () => {
    assert.equal(isChannelId('general'), true);
    assert.equal(isChannelId('my-room-2'), true);
    assert.equal(isChannelId('General'), false);
    assert.equal(isChannelId('-x'), false);
    assert.equal(isChannelId('../etc'), false);
    assert.equal(isChannelId(null), false);
  });
  it('recognizes message ids (UUID)', () => {
    assert.equal(isMessageId('3f0b8a5e-8a8e-4f7a-9d3c-1d2e3f4a5b6c'), true);
    assert.equal(isMessageId('not-a-uuid'), false);
    assert.equal(isMessageId(undefined), false);
  });
});
