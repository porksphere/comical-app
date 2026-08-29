import { describe, expect, test } from 'bun:test';

import {
  type ChannelVersionJson,
  type IosSourceJson,
  compareVersions,
  noteLines,
  readChannelVersion,
  readIosSource,
} from './release-notes';

/** An ios-release source: every tag, newest first, each with its CHANGELOG section. */
const iosSource = (headline: string, versions: [string, string][]): IosSourceJson => ({
  apps: [
    {
      version: headline,
      downloadURL: `https://example.test/${headline}.ipa`,
      versions: versions.map(([version, body]) => ({
        version,
        date: '2026-08-26',
        localizedDescription: body,
      })),
    },
  ],
});

describe('compareVersions', () => {
  test('orders by most significant part first', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.2.1', '0.2.1')).toBe(0);
  });

  test('treats a missing 4th part as 0, so a tag outranks nothing built from it', () => {
    expect(compareVersions('0.2.0.1', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.2.0.1')).toBeLessThan(0);
  });

  test('a release base outranks a higher rolling counter under it', () => {
    // Why the counter is safe to restart at .1 on every release.
    expect(compareVersions('0.2.0.1', '0.1.1.4287')).toBeGreaterThan(0);
  });
});

describe('readIosSource', () => {
  test('splits the history at the running version', () => {
    const read = readIosSource(
      iosSource('0.3.0', [
        ['0.3.0', '- Newest thing'],
        ['0.2.1', '- The running one'],
        ['0.2.0', '- Older'],
      ]),
      '0.2.1',
    );
    expect(read.newer).toBe(true);
    expect(read.pending.map((n) => n.version)).toEqual(['0.3.0']);
    expect(read.running?.version).toBe('0.2.1');
    expect(read.running?.body).toBe('- The running one');
    expect(read.downloadUrl).toBe('https://example.test/0.3.0.ipa');
  });

  test('offers every version an install skipped, not just the newest', () => {
    const read = readIosSource(
      iosSource('0.3.0', [
        ['0.3.0', '- c'],
        ['0.2.2', '- b'],
        ['0.2.1', '- a'],
        ['0.2.0', '- running'],
      ]),
      '0.2.0',
    );
    expect(read.pending.map((n) => n.version)).toEqual(['0.3.0', '0.2.2', '0.2.1']);
  });

  test('still reports the running build up to date when it is the headline', () => {
    const read = readIosSource(iosSource('0.2.1', [['0.2.1', '- The running one']]), '0.2.1');
    expect(read.newer).toBe(false);
    expect(read.pending).toEqual([]);
    // The point of reading a manifest with no update in it.
    expect(read.running?.body).toBe('- The running one');
  });

  test('a manifest with no versions[] still decides the update from the legacy fields', () => {
    // What every source looked like before per-version notes existed.
    const read = readIosSource({ apps: [{ version: '0.3.0', downloadURL: 'https://example.test/x.ipa' }] }, '0.2.1');
    expect(read.newer).toBe(true);
    expect(read.latestVersionLabel).toBe('0.3.0');
    expect(read.pending).toEqual([]);
    expect(read.running).toBeUndefined();
  });

  test('drops a version whose notes are empty rather than listing a blank', () => {
    const read = readIosSource(
      iosSource('0.3.0', [
        ['0.3.0', '   '],
        ['0.2.1', ''],
      ]),
      '0.2.1',
    );
    expect(read.pending).toEqual([]);
    expect(read.running).toBeUndefined();
    expect(read.newer).toBe(true); // the update itself is unaffected
  });

  test('an empty or malformed manifest is up to date, never an update', () => {
    expect(readIosSource({}, '0.2.1').newer).toBe(false);
    expect(readIosSource({ apps: [{ version: '0.3.0' }] }, '0.2.1').newer).toBe(false); // no downloadURL
  });
});

describe('readChannelVersion', () => {
  const json = (over: Partial<ChannelVersionJson> = {}): ChannelVersionJson => ({
    commit: 'abc1234',
    version: '0.2.1.42',
    notes: '• Did a thing',
    ...over,
  });

  test('a different commit is the update, and carries its notes', () => {
    const read = readChannelVersion(json(), 'def5678', 'https://example.test/app.apk');
    expect(read.newer).toBe(true);
    expect(read.pending.map((n) => n.body)).toEqual(['• Did a thing']);
    expect(read.downloadUrl).toBe('https://example.test/app.apk');
    // Nothing to say about the running build: this channel only ever describes its current one.
    expect(read.running).toBeUndefined();
  });

  test('the same commit is the running build, and its notes are what it brought', () => {
    const read = readChannelVersion(json(), 'abc1234');
    expect(read.newer).toBe(false);
    expect(read.running?.body).toBe('• Did a thing');
    expect(read.pending).toEqual([]);
  });

  test('an unknown commit on either side reports up to date, not an update', () => {
    // An update prompt that can't say what it is offering is worse than a missed one.
    expect(readChannelVersion(json({ commit: undefined }), 'abc1234').newer).toBe(false);
    expect(readChannelVersion(json(), '').newer).toBe(false);
  });

  test('a channel that publishes no notes still detects the update', () => {
    const read = readChannelVersion(json({ notes: '' }), 'def5678');
    expect(read.newer).toBe(true);
    expect(read.pending).toEqual([]);
  });
});

describe('noteLines', () => {
  test('strips either publisher bullet and drops blanks', () => {
    expect(noteLines('- From CHANGELOG.md\n\n• From a git log\n  * starred\n')).toEqual([
      'From CHANGELOG.md',
      'From a git log',
      'starred',
    ]);
  });

  test('leaves the text itself alone, hyphens inside it included', () => {
    expect(noteLines('- Fix the re-entry - it was wrong (#131) (80e6dee)')).toEqual([
      'Fix the re-entry - it was wrong (#131) (80e6dee)',
    ]);
  });
});
