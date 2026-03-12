const TREE_VIDEO_EXTS = new Set([
    '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv',
    '.m2ts', '.iso', '.rmvb', '.ts', '.m4v', '.mpg',
    '.mpeg', '.webm', '.vob', '.3gp',
]);

const TREE_ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz']);

export const METADATA_FILTER_PRESET = 'jpg,jpeg,png,nfo,txt,srt,ass';

export function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

export function formatCountLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function formatRelativeTime(value, now = Date.now()) {
    if (!value) return 'Unknown';
    const target = typeof value === 'number'
        ? (value < 1e12 ? value * 1000 : value)
        : new Date(value).getTime();
    if (!target) return 'Unknown';

    const diffMs = target - now;
    const diffSeconds = Math.round(diffMs / 1000);
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const ranges = [
        ['year', 60 * 60 * 24 * 365],
        ['month', 60 * 60 * 24 * 30],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60],
    ];

    for (const [unit, seconds] of ranges) {
        if (Math.abs(diffSeconds) >= seconds || unit === 'minute') {
            return formatter.format(Math.round(diffSeconds / seconds), unit);
        }
    }

    return formatter.format(diffSeconds, 'second');
}

export async function copyText(value) {
    if (!value) return false;

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // fall through to textarea fallback
    }

    if (typeof document === 'undefined') return false;

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        document.body.removeChild(textarea);
        return false;
    }
}

export function getScanDisplayPath(scan) {
    const direct = scan?.scan_path || scan?.root_path;
    if (direct) return direct;

    const firstLine = String(scan?.first_line || '').trim();
    if (!firstLine) return '';

    const withoutSize = firstLine.replace(/^\[[^\]]*\]\s*/, '').trim();
    return withoutSize.replace(/\s+used in.+$/, '').trim();
}

export function matchesScanQuery(scan, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return getScanDisplayPath(scan).toLowerCase().includes(normalized)
        || String(scan?.file || '').toLowerCase().includes(normalized);
}

export function filterAndSortBrowseItems(items, query, sortKey = 'name-asc') {
    const normalized = query.trim().toLowerCase();
    const filtered = items.filter(item => {
        if (!normalized) return true;
        return item.name.toLowerCase().includes(normalized) || item.path.toLowerCase().includes(normalized);
    });

    const direction = sortKey.endsWith('-desc') ? -1 : 1;
    const baseKey = sortKey.replace(/-(asc|desc)$/, '');

    return [...filtered].sort((left, right) => {
        if (baseKey === 'size') {
            if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
            if (left.size !== right.size) return (left.size - right.size) * direction;
            return left.name.localeCompare(right.name);
        }

        if (baseKey === 'type') {
            if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
            return left.name.localeCompare(right.name) * direction;
        }

        if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
        return left.name.localeCompare(right.name) * direction;
    });
}

export function deriveBrowseStats(items) {
    return items.reduce((accumulator, item) => {
        if (item.is_dir) {
            accumulator.directories += 1;
        } else {
            accumulator.files += 1;
            accumulator.totalFileBytes += item.size || 0;
        }
        return accumulator;
    }, { directories: 0, files: 0, totalFileBytes: 0 });
}

export function scoreAnalysisHealth(data, linkData) {
    if (!data?.summary) {
        return {
            score: 0,
            tone: 'neutral',
            label: 'No scan loaded',
            message: 'Run or open a scan to unlock richer cleanup guidance.',
        };
    }

    const counts = {
        empty: data.empty_dirs?.length ?? 0,
        garbage: data.garbage_files?.length ?? 0,
        metadata: data.only_metadata?.length ?? 0,
        missingVideo: data.no_videos?.length ?? 0,
        btJunk: data.bt_junk_files?.length ?? 0,
        brokenSymlinks: linkData?.broken_symlinks ?? 0,
    };

    const weightedIssues = (
        counts.garbage * 4
        + counts.btJunk * 4
        + counts.metadata * 3
        + counts.brokenSymlinks * 3
        + counts.empty * 2
        + counts.missingVideo
    );
    const scale = Math.max((data.summary.total_dirs || 0) + Math.ceil((data.summary.total_files || 0) / 5), 12);
    const score = Math.max(0, Math.min(100, Math.round(100 - (weightedIssues / scale) * 100)));

    if (score >= 80) {
        return {
            score,
            tone: 'good',
            label: 'Healthy workspace',
            message: counts.garbage || counts.btJunk
                ? 'A few cleanup candidates remain, but the scan is generally in good shape.'
                : 'No major warning signs surfaced in the current scan.',
        };
    }

    if (score >= 55) {
        return {
            score,
            tone: 'warning',
            label: 'Moderate cleanup opportunity',
            message: 'There are enough metadata, junk, or empty folders to justify a focused cleanup pass.',
        };
    }

    return {
        score,
        tone: 'danger',
        label: 'Needs attention',
        message: 'This scan has a high concentration of cleanup candidates or broken links.',
    };
}

export function buildDashboardHighlights(data, linkData) {
    if (!data?.summary) return [];

    const cleanupCandidates = (
        (data.empty_dirs?.length ?? 0)
        + (data.garbage_files?.length ?? 0)
        + (data.bt_junk_files?.length ?? 0)
        + (data.only_metadata?.length ?? 0)
    );

    return [
        {
            title: 'Cleanup targets',
            value: formatCountLabel(cleanupCandidates, 'item'),
            description: cleanupCandidates
                ? 'Empty folders, metadata-only folders, and junk files ready for review.'
                : 'Nothing obvious is waiting for cleanup in this scan.',
            tone: cleanupCandidates ? 'warning' : 'good',
        },
        {
            title: 'Archive/video coverage',
            value: formatCountLabel(data.has_archives?.length ?? 0, 'archive hit'),
            description: `${formatCountLabel(data.no_videos?.length ?? 0, 'folder')} without videos.`,
            tone: (data.no_videos?.length ?? 0) > 0 ? 'warning' : 'neutral',
        },
        {
            title: 'Link savings',
            value: formatSize(linkData?.saved_bytes || 0),
            description: `${formatCountLabel(linkData?.hardlink_groups ?? 0, 'hardlink group')}, ${formatCountLabel(linkData?.symlink_count ?? 0, 'symlink')}.`,
            tone: (linkData?.saved_bytes ?? 0) > 0 ? 'good' : 'neutral',
        },
    ];
}

export function buildTreeDirectoryIndex(nodes) {
    const directoryMap = new Map();
    const parentMap = new Map();
    const stack = [];
    let rootDepth = null;

    const finalizeNode = () => {
        const finished = stack.pop();
        if (!finished || !stack.length) return;
        const parent = stack[stack.length - 1];

        parent.totalSubdirCount += 1 + finished.totalSubdirCount;
        parent.fileCount += finished.fileCount;
        parent.fileSize += finished.fileSize;
        finished.extCounts.forEach((count, ext) => {
            parent.extCounts.set(ext, (parent.extCounts.get(ext) || 0) + count);
        });
        parent.hasVideo = parent.hasVideo || finished.hasVideo;
        parent.hasArchive = parent.hasArchive || finished.hasArchive;
    };

    for (const node of nodes) {
        while (stack.length && stack[stack.length - 1].depth >= node.depth) {
            finalizeNode();
        }

        const parent = stack[stack.length - 1];
        parentMap.set(node.path, parent?.path || '');

        if (node.is_file) {
            if (!parent) continue;
            const ext = normalizeExt(node.ext);
            parent.fileCount += 1;
            parent.fileSize += node.size || 0;
            parent.extCounts.set(ext, (parent.extCounts.get(ext) || 0) + 1);
            parent.hasVideo = parent.hasVideo || TREE_VIDEO_EXTS.has(ext);
            parent.hasArchive = parent.hasArchive || TREE_ARCHIVE_EXTS.has(ext);
            continue;
        }

        if (rootDepth === null) rootDepth = node.depth;
        const meta = {
            ...node,
            parentPath: parent?.path || '',
            relativeDepth: node.depth - rootDepth,
            fileCount: 0,
            fileSize: 0,
            totalSubdirCount: 0,
            extCounts: new Map(),
            hasVideo: false,
            hasArchive: false,
            extSummary: '',
        };
        directoryMap.set(node.path, meta);
        stack.push(meta);
    }

    while (stack.length) {
        finalizeNode();
    }

    directoryMap.forEach(meta => {
        meta.extSummary = summarizeExtCounts(meta.extCounts);
    });

    return {
        directories: Array.from(directoryMap.values()),
        directoryMap,
        parentMap,
    };
}

export function applyTreeCollapse(nodes, collapsed) {
    const visibleNodes = [];
    const hiddenPrefixes = new Set();
    for (const node of nodes) {
        let hidden = false;
        for (const prefix of hiddenPrefixes) {
            if (node.path.startsWith(`${prefix}/`)) {
                hidden = true;
                break;
            }
        }
        if (hidden) continue;
        visibleNodes.push(node);
        if (!node.is_file && collapsed.has(node.path)) {
            hiddenPrefixes.add(node.path);
        }
    }
    return visibleNodes;
}

export function addPathWithAncestors(path, parentMap, targetSet) {
    let current = path;
    while (current) {
        if (targetSet.has(current)) break;
        targetSet.add(current);
        current = parentMap.get(current) || '';
    }
}

export function matchesNodeQuery(node, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return node.name.toLowerCase().includes(normalized) || node.path.toLowerCase().includes(normalized);
}

export function parseExtensionList(value) {
    return value
        .split(',')
        .map(item => normalizeExt(item))
        .filter(Boolean);
}

export function normalizeExt(value) {
    const clean = String(value || '').trim().toLowerCase().replace(/^\.+/, '');
    return clean ? `.${clean}` : '';
}

export function summarizeExtCounts(extCounts, limit = 3) {
    const entries = Array.from(extCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit);

    if (entries.length === 0) return '';

    const summary = entries.map(([ext]) => ext || '(no ext)').join(', ');
    return extCounts.size > limit ? `${summary}, +${extCounts.size - limit}` : summary;
}

export function parseLevelFilter(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseSizeInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b?)?$/i);
    if (!match) return Number.NaN;
    const amount = Number(match[1]);
    const unit = (match[2] || 'b').toLowerCase();
    const scale = {
        b: 1,
        k: 1024,
        kb: 1024,
        m: 1024 ** 2,
        mb: 1024 ** 2,
        g: 1024 ** 3,
        gb: 1024 ** 3,
        t: 1024 ** 4,
        tb: 1024 ** 4,
    }[unit];
    return scale ? Math.round(amount * scale) : Number.NaN;
}

export function parentPath(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    if (index <= 0) return normalized;
    return normalized.slice(0, index);
}
