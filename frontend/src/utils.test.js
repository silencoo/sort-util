import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDashboardHighlights,
    deriveBrowseStats,
    filterAndSortBrowseItems,
    formatRelativeTime,
    getScanDisplayPath,
    parseSizeInput,
    scoreAnalysisHealth,
} from './utils.js';

test('parseSizeInput supports shorthand sizes', () => {
    assert.equal(parseSizeInput('1.5GB'), 1610612736);
    assert.equal(parseSizeInput('500mb'), 524288000);
    assert.equal(parseSizeInput('42'), 42);
    assert.equal(Number.isNaN(parseSizeInput('nope')), true);
});

test('formatRelativeTime returns friendly values', () => {
    const now = new Date('2026-03-12T12:00:00Z').getTime();
    assert.equal(formatRelativeTime('2026-03-12T11:00:00Z', now), '1 hour ago');
    assert.equal(formatRelativeTime('2026-03-12T12:10:00Z', now), 'in 10 minutes');
    assert.equal(formatRelativeTime(Math.floor(new Date('2026-03-12T11:59:00Z').getTime() / 1000), now), '1 minute ago');
});

test('getScanDisplayPath prefers extracted root path', () => {
    assert.equal(getScanDisplayPath({ scan_path: '/data/library' }), '/data/library');
    assert.equal(
        getScanDisplayPath({ first_line: '[ 14G]  /data/library' }),
        '/data/library',
    );
});

test('filterAndSortBrowseItems filters by query and keeps directories first', () => {
    const items = [
        { name: 'movies', path: '/data/movies', is_dir: true, size: 0 },
        { name: 'notes.txt', path: '/data/notes.txt', is_dir: false, size: 1200 },
        { name: 'anime', path: '/data/anime', is_dir: true, size: 0 },
    ];

    const filtered = filterAndSortBrowseItems(items, 'anime', 'name-desc');
    assert.deepEqual(filtered.map(item => item.name), ['anime']);
});

test('deriveBrowseStats totals directories, files, and file bytes', () => {
    const stats = deriveBrowseStats([
        { is_dir: true, size: 0 },
        { is_dir: false, size: 15 },
        { is_dir: false, size: 25 },
    ]);

    assert.deepEqual(stats, {
        directories: 1,
        files: 2,
        totalFileBytes: 40,
    });
});

test('scoreAnalysisHealth and highlights reflect issue density', () => {
    const data = {
        summary: { total_dirs: 8, total_files: 20 },
        empty_dirs: [{}, {}],
        garbage_files: [{}, {}, {}],
        only_metadata: [{}],
        no_videos: [{}, {}, {}],
        has_archives: [{}],
        bt_junk_files: [{}],
    };
    const links = {
        saved_bytes: 2048,
        hardlink_groups: 1,
        symlink_count: 2,
        broken_symlinks: 1,
    };

    const health = scoreAnalysisHealth(data, links);
    const highlights = buildDashboardHighlights(data, links);

    assert.equal(health.tone, 'danger');
    assert.equal(highlights.length, 3);
    assert.equal(highlights[0].title, 'Cleanup targets');
    assert.equal(highlights[2].value, '2.0 KB');
});
