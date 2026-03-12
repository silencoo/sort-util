import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    LayoutDashboard, FileArchive, Search, Trash2,
    FolderOpen, VideoOff, Settings, RefreshCw,
    AlertTriangle, X, HardDrive, Bug, Edit3, CheckCircle,
    ChevronRight, ChevronDown, File, Folder, TreePine, Save, Download,
    ArrowUp, FolderSearch, CheckCircle2, Play,
} from 'lucide-react';

const API = '';

// ===================== App =====================

export default function App() {
    const [page, setPage] = useState('dashboard');
    const [toast, setToast] = useState(null);
    const [activeScanPath, setActiveScanPath] = useState('');
    const [browsePath, setBrowsePath] = useState('');

    const showToast = useCallback((message, type = 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 5000);
    }, []);

    const switchToAnalysis = (path) => {
        setActiveScanPath(path);
        setPage('dashboard');
    };

    const switchToBrowse = (path) => {
        setBrowsePath(path || '');
        setPage('browse');
    };

    return (
        <div className="app-container">
            {toast && (
                <div className={`toast toast-${toast.type}`}>
                    <span>{toast.message}</span>
                    <button onClick={() => setToast(null)} className="toast-close"><X size={14} /></button>
                </div>
            )}
            <aside className="sidebar">
                <div className="logo"><FolderOpen size={24} className="icon-primary" /><h2>FileAnalyzer</h2></div>
                <nav>
                    {[
                        { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
                        { id: 'browse', icon: FolderSearch, label: 'Browse' },
                        { id: 'tree', icon: TreePine, label: 'Tree View' },
                        { id: 'cleanup', icon: Trash2, label: 'Cleanup' },
                        { id: 'settings', icon: Settings, label: 'Settings' },
                    ].map(item => (
                        <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`}
                            onClick={() => setPage(item.id)}>
                            <item.icon size={18} /> {item.label}
                        </button>
                    ))}
                </nav>
                {activeScanPath && (
                    <div className="sidebar-info">
                        <small>Active scan:</small>
                        <span>{activeScanPath.split('/').pop() || activeScanPath}</span>
                    </div>
                )}
            </aside>
            <main className="main-content">
                {page === 'dashboard' && (
                    <DashboardPage
                        showToast={showToast}
                        activePath={activeScanPath}
                        setActivePath={setActiveScanPath}
                        onBrowsePath={switchToBrowse}
                    />
                )}
                {page === 'browse' && <BrowsePage showToast={showToast} onAnalyze={switchToAnalysis} initialPath={browsePath} />}
                {page === 'tree' && <TreeViewPage showToast={showToast} activePath={activeScanPath} />}
                {page === 'cleanup' && <CleanupPage showToast={showToast} />}
                {page === 'settings' && <SettingsPage showToast={showToast} />}
            </main>
        </div>
    );
}

// ===================== Dashboard =====================

function DashboardPage({ showToast, activePath, setActivePath, onBrowsePath }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [linksLoading, setLinksLoading] = useState(false);
    const [linkData, setLinkData] = useState(null);
    const [emptyHint, setEmptyHint] = useState('');
    const [scanPath, setScanPath] = useState(activePath || '/data');

    useEffect(() => {
        if (activePath) setScanPath(activePath);
    }, [activePath]);

    useEffect(() => {
        if (activePath) return;
        fetch(`${API}/api/config`)
            .then(r => r.json())
            .then(cfg => {
                if (cfg?.data_dir) {
                    setScanPath(prev => (prev === '/data' || !prev ? cfg.data_dir : prev));
                }
            })
            .catch(() => { /* ignore config fallback errors */ });
    }, [activePath]);

    const loadLinks = useCallback(async (path) => {
        if (!path) {
            setLinkData(null);
            return;
        }
        setLinksLoading(true);
        try {
            const r = await fetch(`${API}/api/links?path=${encodeURIComponent(path)}`);
            const d = await r.json();
            if (!r.ok || d.error) {
                setLinkData(null);
                showToast(d.error || 'Link analysis failed');
                return;
            }
            setLinkData(d);
        } catch {
            setLinkData(null);
            showToast('Failed to analyze hardlinks/symlinks');
        } finally {
            setLinksLoading(false);
        }
    }, [showToast]);

    const loadData = useCallback(async (path) => {
        setLoading(true);
        const url = path ? `${API}/api/analyze?path=${encodeURIComponent(path)}` : `${API}/api/analyze`;
        try {
            const r = await fetch(url);
            const d = await r.json();
            if (!r.ok || d.error) {
                setData(null);
                setLinkData(null);
                if (r.status === 404 && (d.error || '').includes('No scan data found')) {
                    setEmptyHint('No scan data yet. Use Scan or Browse to start.');
                    return;
                }
                setEmptyHint('');
                showToast(d.error || 'Failed to load analysis');
                return;
            }

            setData(d);
            setEmptyHint('');
            const resolvedPath = path || (d.scan_path && d.scan_path !== 'latest' ? d.scan_path : '');
            if (resolvedPath) {
                setScanPath(resolvedPath);
                loadLinks(resolvedPath);
            } else {
                setLinkData(null);
            }
        } catch {
            setData(null);
            setLinkData(null);
            showToast('Failed to connect');
        } finally {
            setLoading(false);
        }
    }, [loadLinks, showToast]);

    useEffect(() => { loadData(activePath); }, [activePath, loadData]);

    const handleRescan = async () => {
        const nextPath = scanPath.trim();
        if (!nextPath) {
            showToast('Directory path is required');
            return;
        }
        setScanning(true);
        try {
            const r = await fetch(`${API}/api/generate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: nextPath }),
            });
            const d = await r.json();
            if (!r.ok || d.error) {
                showToast(d.error || 'Scan failed');
                return;
            }
            showToast(d.message, 'success');
            if (activePath === nextPath) {
                await loadData(nextPath);
            } else {
                setActivePath(nextPath);
            }
        } catch {
            showToast('Scan failed');
        } finally {
            setScanning(false);
        }
    };

    const exportPath = activePath || (data?.scan_path && data.scan_path !== 'latest' ? data.scan_path : '');
    const exportUrl = exportPath ? `/api/export?path=${encodeURIComponent(exportPath)}` : '/api/export';
    const exportCsvUrl = `${exportUrl}${exportUrl.includes('?') ? '&' : '?'}format=csv`;
    const exportJsonUrl = `${exportUrl}${exportUrl.includes('?') ? '&' : '?'}format=json`;

    return (
        <>
            <header className="topbar">
                <h1>Dashboard</h1>
                <div className="scan-controls">
                    <input className="scan-input" value={scanPath} onChange={e => setScanPath(e.target.value)}
                        placeholder="Directory path..." onKeyDown={e => e.key === 'Enter' && handleRescan()} />
                    <button className="btn-primary" onClick={handleRescan} disabled={scanning}>
                        <RefreshCw size={16} className={scanning ? 'spin' : ''} /> {scanning ? 'Scanning...' : 'Scan'}
                    </button>
                </div>
            </header>
            {loading ? <LoadingInline /> : !data ? <EmptyState message={emptyHint || 'Enter a directory path and click Scan, or use Browse to select a folder.'} /> : (
                <>
                    {data.summary && (
                        <div className="summary-bar">
                            <span><HardDrive size={14} /> {data.summary.total_dirs} dirs</span><span>•</span>
                            <span>{data.summary.total_files} files</span><span>•</span>
                            <span>{formatSize(data.summary.total_size)}</span>
                            {data.scan_path && <span className="tag">{data.scan_path}</span>}
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                                <a href={exportCsvUrl} className="btn-sm" download><Download size={12} /> CSV</a>
                                <a href={exportJsonUrl} className="btn-sm" download><Download size={12} /> JSON</a>
                            </span>
                        </div>
                    )}
                    <section className="stats-grid">
                        <StatCard title="Empty Dirs" value={data.empty_dirs?.length ?? 0} icon={<FolderOpen size={24} />} color="blue" />
                        <StatCard title="Garbage" value={data.garbage_files?.length ?? 0} icon={<Trash2 size={24} />} color="red" />
                        <StatCard title="No Videos" value={data.no_videos?.length ?? 0} icon={<VideoOff size={24} />} color="orange" />
                        <StatCard title="Metadata Only" value={data.only_metadata?.length ?? 0} icon={<Search size={24} />} color="purple" />
                        <StatCard title="Archives" value={data.has_archives?.length ?? 0} icon={<FileArchive size={24} />} color="green" />
                        <StatCard title="BT Junk" value={data.bt_junk_files?.length ?? 0} icon={<Bug size={24} />} color="red" />
                        <StatCard title="Hardlink Groups" value={linkData?.hardlink_groups ?? 0} icon={<HardDrive size={24} />} color="green" />
                        <StatCard title="Symlinks" value={linkData?.symlink_count ?? 0} icon={<FolderSearch size={24} />} color="blue" />
                    </section>
                    <section className="detailed-view">
                        <DetailCard title="Garbage Files" items={data.garbage_files}
                            renderItem={f => (
                                <>
                                    <Trash2 size={14} className="icon-red" />
                                    <ResultPathRow path={f.path} type="file" onBrowsePath={onBrowsePath} />
                                    <span className="tag">{f.reason}</span>
                                </>
                            )} />
                        <DetailCard title="Empty Directories" items={data.empty_dirs}
                            renderItem={d => (
                                <>
                                    <FolderOpen size={14} className="icon-blue" />
                                    <ResultPathRow path={d.path} type="dir" onBrowsePath={onBrowsePath} />
                                </>
                            )} />
                        <DetailCard title="Metadata-Only" items={data.only_metadata}
                            renderItem={d => (
                                <>
                                    <Search size={14} className="icon-purple" />
                                    <ResultPathRow path={d.path} type="dir" onBrowsePath={onBrowsePath} />
                                    <span className="tag">{d.file_count} files</span>
                                </>
                            )} />
                        <DetailCard title="BT Junk" items={data.bt_junk_files}
                            renderItem={f => (
                                <>
                                    <Bug size={14} className="icon-red" />
                                    <ResultPathRow path={f.path} type="file" onBrowsePath={onBrowsePath} />
                                </>
                            )} />
                        <LinkInsightsCard data={linkData} loading={linksLoading} onBrowsePath={onBrowsePath} />
                    </section>
                </>
            )}
        </>
    );
}

// ===================== Browse Page =====================

function BrowsePage({ showToast, onAnalyze, initialPath }) {
    const [items, setItems] = useState([]);
    const [current, setCurrent] = useState('');
    const [parent, setParent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(null); // path being scanned

    const browse = useCallback(async (path) => {
        setLoading(true);
        const url = path ? `${API}/api/browse?path=${encodeURIComponent(path)}` : `${API}/api/browse`;
        try {
            const r = await fetch(url);
            const d = await r.json();
            if (!r.ok || d.error) {
                showToast(d.error || 'Browse failed');
                setItems([]);
                setCurrent('');
                setParent(null);
                return;
            }
            setItems(d.items || []);
            setCurrent(d.current);
            setParent(d.parent);
        } catch {
            showToast('Browse failed');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { browse(initialPath || ''); }, [browse, initialPath]);

    const handleScanDir = async (dirPath) => {
        setScanning(dirPath);
        try {
            const r = await fetch(`${API}/api/generate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dirPath }),
            });
            const d = await r.json();
            if (!r.ok || d.error) {
                showToast(d.error || 'Scan failed');
                return;
            }
            showToast(`Scanned ${dirPath}`, 'success');
            browse(current || dirPath); // refresh to update has_scan badges
        } catch {
            showToast('Scan failed');
        } finally {
            setScanning(null);
        }
    };

    const dirs = items.filter(i => i.is_dir);
    const files = items.filter(i => !i.is_dir);

    return (
        <>
            <header className="topbar">
                <h1>Browse Directories</h1>
            </header>

            {/* Breadcrumb */}
            <div className="browse-breadcrumb">
                <span className="browse-path">{current || '/'}</span>
                {parent && (
                    <button className="btn-sm" onClick={() => browse(parent)}><ArrowUp size={12} /> Up</button>
                )}
            </div>

            {loading ? <LoadingInline /> : (
                <div className="browse-grid">
                    {dirs.map((item, i) => (
                        <div key={i} className="browse-card">
                            <div className="browse-card-top" onClick={() => browse(item.path)}>
                                <Folder size={20} className="icon-primary" />
                                <span className="browse-name">{item.name}</span>
                                {item.has_scan && <CheckCircle2 size={14} className="icon-green" title="Has cached scan" />}
                            </div>
                            <div className="browse-card-actions">
                                <button className="btn-sm" onClick={() => handleScanDir(item.path)}
                                    disabled={scanning === item.path}>
                                    <RefreshCw size={12} className={scanning === item.path ? 'spin' : ''} />
                                    {scanning === item.path ? 'Scanning...' : 'Scan'}
                                </button>
                                {item.has_scan && (
                                    <button className="btn-sm btn-sm-primary" onClick={() => onAnalyze(item.path)}>
                                        <Play size={12} /> Analyze
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {dirs.length === 0 && files.length === 0 && <p className="empty-text">Empty directory</p>}
                </div>
            )}

            {files.length > 0 && (
                <details className="files-summary">
                    <summary>{files.length} files in this directory</summary>
                    <ul className="file-list">
                        {files.slice(0, 50).map((f, i) => (
                            <li key={i}><File size={14} /> {f.name} <span className="tree-size">{formatSize(f.size)}</span></li>
                        ))}
                    </ul>
                </details>
            )}
        </>
    );
}

// ===================== Tree View =====================

function TreeViewPage({ showToast, activePath }) {
    const [nodes, setNodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [resolvedPath, setResolvedPath] = useState('');
    const [nameFilter, setNameFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState('');
    const [minSizeFilter, setMinSizeFilter] = useState('');
    const [maxSizeFilter, setMaxSizeFilter] = useState('');
    const [onlyExtFilter, setOnlyExtFilter] = useState('');
    const [requireExtFilter, setRequireExtFilter] = useState('');
    const [requireMediaOrArchive, setRequireMediaOrArchive] = useState(false);
    const [showFiles, setShowFiles] = useState(true);
    const [collapsed, setCollapsed] = useState(new Set());
    const [cleanupPreview, setCleanupPreview] = useState(null);
    const [cleanupLoading, setCleanupLoading] = useState(false);
    const [cleanupExecuting, setCleanupExecuting] = useState(false);
    const [cleanupMode, setCleanupMode] = useState('quarantine'); // quarantine | delete
    const [presetName, setPresetName] = useState('');
    const [presets, setPresets] = useState([]);
    const [importData, setImportData] = useState('');

    const loadTree = useCallback(async (pathHint = '') => {
        setLoading(true);
        const requestPath = pathHint || activePath || '';
        const url = requestPath ? `${API}/api/tree?path=${encodeURIComponent(requestPath)}` : `${API}/api/tree`;
        try {
            const r = await fetch(url);
            const d = await r.json();
            if (!r.ok || d.error) {
                setNodes([]);
                setResolvedPath('');
                showToast(d.error || 'Failed to load tree');
                return;
            }
            setNodes(d.nodes || []);
            setResolvedPath(d.scan_path || requestPath || '');
        } catch {
            setNodes([]);
            setResolvedPath('');
            showToast('Failed to load tree');
        } finally {
            setLoading(false);
        }
    }, [activePath, showToast]);

    useEffect(() => {
        setCollapsed(new Set());
        setCleanupPreview(null);
        loadTree(activePath || '');
    }, [activePath, loadTree]);

    useEffect(() => {
        setPresets(loadTreePresets());
    }, []);

    const treeModel = useMemo(() => buildTreeDirectoryIndex(nodes), [nodes]);
    const normalizedName = nameFilter.trim().toLowerCase();
    const onlyExts = useMemo(() => parseExtensionList(onlyExtFilter), [onlyExtFilter]);
    const requiredExts = useMemo(() => parseExtensionList(requireExtFilter), [requireExtFilter]);
    const onlyExtSet = useMemo(() => new Set(onlyExts), [onlyExts]);
    const levelValue = useMemo(() => parseLevelFilter(levelFilter), [levelFilter]);
    const minBytes = useMemo(() => parseSizeInput(minSizeFilter), [minSizeFilter]);
    const maxBytes = useMemo(() => parseSizeInput(maxSizeFilter), [maxSizeFilter]);
    const invalidLevel = levelFilter.trim() && levelValue === null;
    const invalidSize = Number.isNaN(minBytes) || Number.isNaN(maxBytes);
    const advancedFilterActive = Boolean(
        levelFilter.trim() || minSizeFilter.trim() || maxSizeFilter.trim() ||
        onlyExts.length || requiredExts.length || requireMediaOrArchive
    );
    const filterModeActive = advancedFilterActive || Boolean(normalizedName);

    const matchedDirs = useMemo(() => {
        if (invalidLevel || invalidSize) return [];
        return treeModel.directories.filter(dir => {
            if (normalizedName && !matchesNodeQuery(dir, normalizedName)) return false;
            if (levelValue !== null && dir.relativeDepth !== levelValue) return false;
            if (minBytes !== null && dir.size < minBytes) return false;
            if (maxBytes !== null && dir.size > maxBytes) return false;
            if (onlyExts.length) {
                if (!dir.fileCount) return false;
                for (const ext of dir.extCounts.keys()) {
                    if (!onlyExtSet.has(ext)) return false;
                }
            }
            if (requiredExts.length && !requiredExts.some(ext => dir.extCounts.has(ext))) return false;
            if (requireMediaOrArchive && !(dir.hasVideo || dir.hasArchive)) return false;
            return true;
        });
    }, [
        treeModel.directories,
        normalizedName,
        levelValue,
        minBytes,
        maxBytes,
        onlyExts,
        onlyExtSet,
        requiredExts,
        requireMediaOrArchive,
        invalidLevel,
        invalidSize,
    ]);

    const matchedDirPathSet = useMemo(() => new Set(matchedDirs.map(dir => dir.path)), [matchedDirs]);

    const matchedFilePathSet = useMemo(() => {
        const result = new Set();
        if (!normalizedName || advancedFilterActive || !showFiles) return result;
        for (const node of nodes) {
            if (node.is_file && matchesNodeQuery(node, normalizedName)) {
                result.add(node.path);
            }
        }
        return result;
    }, [nodes, normalizedName, advancedFilterActive, showFiles]);

    const cleanupTargets = useMemo(() => {
        if (!filterModeActive) return [];
        return matchedDirs
            .filter(dir => dir.relativeDepth > 0)
            .filter(dir => {
                let currentParent = dir.parentPath;
                while (currentParent) {
                    if (matchedDirPathSet.has(currentParent)) return false;
                    currentParent = treeModel.parentMap.get(currentParent) || '';
                }
                return true;
            });
    }, [filterModeActive, matchedDirs, matchedDirPathSet, treeModel.parentMap]);

    useEffect(() => {
        setCleanupPreview(null);
    }, [
        nodes,
        nameFilter,
        levelFilter,
        minSizeFilter,
        maxSizeFilter,
        onlyExtFilter,
        requireExtFilter,
        requireMediaOrArchive,
        showFiles,
        cleanupMode,
    ]);

    const toggleCollapse = (path) => {
        setCollapsed(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
    };

    const visibleTree = useMemo(() => {
        const includePaths = new Set();
        const highlightedPaths = new Set();

        if (!filterModeActive) {
            const visibleNodes = applyTreeCollapse(
                nodes.filter(node => showFiles || !node.is_file),
                collapsed,
            );
            return { visibleNodes, highlightedPaths };
        }

        matchedDirPathSet.forEach(path => {
            highlightedPaths.add(path);
            addPathWithAncestors(path, treeModel.parentMap, includePaths);
        });
        matchedFilePathSet.forEach(path => {
            highlightedPaths.add(path);
            addPathWithAncestors(path, treeModel.parentMap, includePaths);
        });

        const activeMatches = [];
        for (const node of nodes) {
            while (activeMatches.length && activeMatches[activeMatches.length - 1].depth >= node.depth) {
                activeMatches.pop();
            }
            if (activeMatches.length) {
                includePaths.add(node.path);
            }
            if (!node.is_file && matchedDirPathSet.has(node.path)) {
                includePaths.add(node.path);
                activeMatches.push(node);
            }
            if (matchedFilePathSet.has(node.path)) {
                includePaths.add(node.path);
            }
        }

        const visibleNodes = applyTreeCollapse(
            nodes.filter(node => includePaths.has(node.path) && (showFiles || !node.is_file)),
            collapsed,
        );

        return { visibleNodes, highlightedPaths };
    }, [
        nodes,
        collapsed,
        showFiles,
        filterModeActive,
        matchedDirPathSet,
        matchedFilePathSet,
        treeModel.parentMap,
    ]);

    const resetFilters = () => {
        setNameFilter('');
        setLevelFilter('');
        setMinSizeFilter('');
        setMaxSizeFilter('');
        setOnlyExtFilter('');
        setRequireExtFilter('');
        setRequireMediaOrArchive(false);
        setShowFiles(true);
    };

    const handlePreviewCleanup = async () => {
        if (invalidLevel || invalidSize) {
            showToast('Fix invalid tree filters first');
            return;
        }
        if (!filterModeActive || cleanupTargets.length === 0) {
            showToast('No matched folders to clean');
            return;
        }

        setCleanupLoading(true);
        try {
            const r = await fetch(`${API}/api/preview-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: cleanupTargets.map(dir => dir.path) }),
            });
            const d = await r.json();
            if (!r.ok || d.error) {
                showToast(d.error || 'Cleanup preview failed');
                return;
            }
            setCleanupPreview(d);
        } catch {
            showToast('Cleanup preview failed');
        } finally {
            setCleanupLoading(false);
        }
    };

    const handleExecuteCleanup = async () => {
        if (!cleanupPreview?.matches?.length) return;
        setCleanupExecuting(true);
        try {
            const r = await fetch(`${API}/api/execute-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operations: cleanupPreview.matches,
                    mode: cleanupMode,
                    root_hint: activePath || resolvedPath || '',
                }),
            });
            const d = await r.json();
            if (!r.ok || d.error) {
                showToast(d.error || 'Cleanup failed');
                return;
            }

            const scanTarget = activePath || resolvedPath;
            if (scanTarget) {
                const refreshResponse = await fetch(`${API}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: scanTarget }),
                });
                const refreshData = await refreshResponse.json();
                if (!refreshResponse.ok || refreshData.error) {
                    showToast(refreshData.error || 'Cleanup finished, but rescan failed');
                }
            }

            const movedBytes = d.moved_bytes ?? d.freed_bytes;
            showToast(
                `Done: ${d.success} ok${d.failed ? `, ${d.failed} failed` : ''}${movedBytes ? `, ${cleanupMode === 'quarantine' ? 'moved' : 'freed'} ${formatSize(movedBytes)}` : ''}`,
                d.failed ? 'error' : 'success',
            );
            setCleanupPreview(null);
            await loadTree(activePath || resolvedPath || '');
        } catch {
            showToast('Cleanup failed');
        } finally {
            setCleanupExecuting(false);
        }
    };

    const handleSavePreset = () => {
        const name = presetName.trim();
        if (!name) {
            showToast('Preset name is required');
            return;
        }
        const saved = saveTreePreset(name, {
            nameFilter,
            levelFilter,
            minSizeFilter,
            maxSizeFilter,
            onlyExtFilter,
            requireExtFilter,
            requireMediaOrArchive,
            showFiles,
        });
        setPresets(saved);
        setPresetName('');
        showToast(`Saved preset "${name}"`, 'success');
    };

    const handleApplyPreset = (preset) => {
        setNameFilter(preset.nameFilter || '');
        setLevelFilter(preset.levelFilter || '');
        setMinSizeFilter(preset.minSizeFilter || '');
        setMaxSizeFilter(preset.maxSizeFilter || '');
        setOnlyExtFilter(preset.onlyExtFilter || '');
        setRequireExtFilter(preset.requireExtFilter || '');
        setRequireMediaOrArchive(Boolean(preset.requireMediaOrArchive));
        setShowFiles(preset.showFiles !== false);
    };

    const handleDeletePreset = (name) => {
        const next = deleteTreePreset(name);
        setPresets(next);
        showToast(`Removed preset "${name}"`, 'success');
    };

    const handleExportPresets = () => {
        const payload = JSON.stringify(presets, null, 2);
        setImportData(payload);
        showToast('Presets exported to text box', 'success');
    };

    const handleImportPresets = () => {
        if (!importData.trim()) {
            showToast('Paste preset JSON first');
            return;
        }
        try {
            const parsed = JSON.parse(importData);
            if (!Array.isArray(parsed)) {
                showToast('Preset JSON must be an array');
                return;
            }
            const normalized = parsed
                .filter(item => item && item.name)
                .map(item => ({
                    name: String(item.name),
                    nameFilter: item.nameFilter || '',
                    levelFilter: item.levelFilter || '',
                    minSizeFilter: item.minSizeFilter || '',
                    maxSizeFilter: item.maxSizeFilter || '',
                    onlyExtFilter: item.onlyExtFilter || '',
                    requireExtFilter: item.requireExtFilter || '',
                    requireMediaOrArchive: Boolean(item.requireMediaOrArchive),
                    showFiles: item.showFiles !== false,
                }));
            window.localStorage.setItem(TREE_PRESET_KEY, JSON.stringify(normalized));
            setPresets(normalized.sort((a, b) => a.name.localeCompare(b.name)));
            showToast('Presets imported', 'success');
        } catch {
            showToast('Invalid preset JSON');
        }
    };

    const activeTags = [];
    if (levelValue !== null) activeTags.push(`level ${levelValue}`);
    if (minBytes !== null && !Number.isNaN(minBytes)) activeTags.push(`>= ${formatSize(minBytes)}`);
    if (maxBytes !== null && !Number.isNaN(maxBytes)) activeTags.push(`<= ${formatSize(maxBytes)}`);
    if (onlyExts.length) activeTags.push(`only ${onlyExts.join(', ')}`);
    if (requiredExts.length) activeTags.push(`has ${requiredExts.join(', ')}`);
    if (requireMediaOrArchive) activeTags.push('need archive/video');
    if (normalizedName) activeTags.push(`name "${nameFilter.trim()}"`);

    const pagePath = activePath || resolvedPath;

    return (
        <>
            <header className="topbar">
                <h1>Tree View {pagePath && <span className="tag">{pagePath}</span>}</h1>
            </header>
            <div className="card tree-filter-card">
                <div className="tree-preset-row">
                    <div className="tree-preset-left">
                        <div className="tree-preset-input">
                            <input
                                className="scan-input"
                                value={presetName}
                                onChange={e => setPresetName(e.target.value)}
                                placeholder="Preset name..."
                            />
                            <button className="btn-sm btn-sm-primary" onClick={handleSavePreset}>
                                Save preset
                            </button>
                            <button className="btn-sm" onClick={handleExportPresets}>
                                Export
                            </button>
                        </div>
                        {presets.length > 0 ? (
                            <div className="tree-preset-list">
                                {presets.map(preset => (
                                    <div key={preset.name} className="tree-preset-chip">
                                        <button className="btn-sm" onClick={() => handleApplyPreset(preset)}>
                                            {preset.name}
                                        </button>
                                        <button className="tree-preset-delete" onClick={() => handleDeletePreset(preset.name)}>
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="tree-preset-empty">No presets yet.</span>
                        )}
                        <div className="tree-preset-import">
                            <textarea
                                className="scan-input tree-preset-textarea"
                                value={importData}
                                onChange={e => setImportData(e.target.value)}
                                placeholder="Paste preset JSON here to import..."
                                rows={3}
                            />
                            <button className="btn-sm" onClick={handleImportPresets}>
                                Import
                            </button>
                        </div>
                    </div>
                    <div className="tree-cleanup-mode">
                        <span>Cleanup mode</span>
                        <div className="tree-cleanup-toggle">
                            <button
                                className={`btn-sm ${cleanupMode === 'quarantine' ? 'btn-sm-primary' : ''}`}
                                onClick={() => setCleanupMode('quarantine')}
                            >
                                Quarantine
                            </button>
                            <button
                                className={`btn-sm ${cleanupMode === 'delete' ? 'btn-sm-primary' : ''}`}
                                onClick={() => setCleanupMode('delete')}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
                <div className="tree-filter-grid">
                    <div className="form-group">
                        <label>Name Filter</label>
                        <input
                            className="scan-input"
                            value={nameFilter}
                            onChange={e => setNameFilter(e.target.value)}
                            placeholder="Folder or file name"
                        />
                    </div>
                    <div className="form-group">
                        <label>Target Level</label>
                        <input
                            className="scan-input"
                            type="number"
                            min="0"
                            value={levelFilter}
                            onChange={e => setLevelFilter(e.target.value)}
                            placeholder="1 = first level under root"
                        />
                    </div>
                    <div className="form-group">
                        <label>Min Folder Size</label>
                        <input
                            className="scan-input"
                            value={minSizeFilter}
                            onChange={e => setMinSizeFilter(e.target.value)}
                            placeholder="500MB"
                        />
                    </div>
                    <div className="form-group">
                        <label>Max Folder Size</label>
                        <input
                            className="scan-input"
                            value={maxSizeFilter}
                            onChange={e => setMaxSizeFilter(e.target.value)}
                            placeholder="5GB"
                        />
                    </div>
                    <div className="form-group">
                        <label>Only Extensions</label>
                        <input
                            className="scan-input"
                            value={onlyExtFilter}
                            onChange={e => setOnlyExtFilter(e.target.value)}
                            placeholder="jpg,nfo,png"
                        />
                    </div>
                    <div className="form-group">
                        <label>Must Contain Extensions</label>
                        <input
                            className="scan-input"
                            value={requireExtFilter}
                            onChange={e => setRequireExtFilter(e.target.value)}
                            placeholder="zip,mkv,mp4"
                        />
                    </div>
                </div>
                <div className="tree-filter-actions">
                    <label className="checkbox-inline">
                        <input
                            type="checkbox"
                            checked={requireMediaOrArchive}
                            onChange={e => setRequireMediaOrArchive(e.target.checked)}
                        />
                        Require archive/video
                    </label>
                    <label className="checkbox-inline">
                        <input
                            type="checkbox"
                            checked={showFiles}
                            onChange={e => setShowFiles(e.target.checked)}
                        />
                        Show files
                    </label>
                    <button
                        className="btn-sm"
                        onClick={() => {
                            setOnlyExtFilter(METADATA_FILTER_PRESET);
                            setRequireExtFilter('');
                            setRequireMediaOrArchive(false);
                        }}
                    >
                        Metadata preset
                    </button>
                    <button className="btn-sm" onClick={resetFilters}>Reset</button>
                    <button
                        className="btn-primary"
                        onClick={handlePreviewCleanup}
                        disabled={!filterModeActive || cleanupTargets.length === 0 || cleanupLoading || invalidLevel || invalidSize}
                    >
                        <Trash2 size={16} /> {cleanupLoading ? 'Preparing...' : `Preview Cleanup (${cleanupTargets.length})`}
                    </button>
                    {cleanupPreview?.matches?.length > 0 && (
                        <button className="btn-danger" onClick={handleExecuteCleanup} disabled={cleanupExecuting}>
                            <CheckCircle size={16} /> {cleanupExecuting ? 'Executing...' : `${cleanupMode === 'quarantine' ? 'Quarantine' : 'Delete'} (${cleanupPreview.matches.length})`}
                        </button>
                    )}
                </div>
                <p className="tree-filter-hint">
                    Level `1` means the first folder layer below the scan root. Size and extension filters inspect the full subtree,
                    so deleting a filtered folder is safer than relying on direct children only.
                </p>
                {(invalidLevel || invalidSize) && (
                    <p className="tree-filter-warning">Level must be a non-negative integer. Size accepts values like `500MB`, `4G`, `120000`.</p>
                )}
            </div>
            <div className="summary-bar">
                <span><TreePine size={14} /> {nodes.length} nodes</span><span>•</span>
                <span>{nodes.filter(n => !n.is_file).length} dirs</span><span>•</span>
                <span>{nodes.filter(n => n.is_file).length} files</span>
                {filterModeActive && <><span>•</span><span>{matchedDirs.length} matched dirs</span></>}
                {filterModeActive && <><span>•</span><span>{cleanupTargets.length} cleanup targets</span></>}
                {activeTags.map(tag => <span key={tag} className="tag">{tag}</span>)}
            </div>
            {cleanupPreview && (
                <div className="card tree-preview-card">
                    <h3>Filtered Cleanup Preview <span className="count">({cleanupPreview.count}, {formatSize(cleanupPreview.total_size || 0)})</span></h3>
                    {cleanupPreview.matches.length === 0 ? <p className="empty-text">No matched folders to delete.</p> : (
                        <div className="preview-table-wrap">
                            <table className="preview-table">
                                <thead><tr><th>Path</th><th>Type</th><th>Size</th></tr></thead>
                                <tbody>
                                    {cleanupPreview.matches.slice(0, 100).map((item, i) => (
                                        <tr key={`${item.path}-${i}`}>
                                            <td className="path-cell">{item.path}</td>
                                            <td><span className="tag">{item.type}</span></td>
                                            <td>{formatSize(item.size)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {cleanupPreview.matches.length > 100 && (
                                <p className="more-text" style={{ padding: '12px' }}>...+{cleanupPreview.matches.length - 100} more</p>
                            )}
                        </div>
                    )}
                </div>
            )}
            {loading ? <LoadingInline /> : nodes.length === 0 ? <EmptyState message="No tree data. Run a scan first." /> : visibleTree.visibleNodes.length === 0 ? (
                <div className="card">
                    <p className="empty-text">No folders matched the current tree filters.</p>
                </div>
            ) : (
                <div className="tree-container">
                    {visibleTree.visibleNodes.slice(0, 500).map((node, i) => {
                        const dirMeta = node.is_file ? null : treeModel.directoryMap.get(node.path);
                        const isHighlighted = visibleTree.highlightedPaths.has(node.path);
                        return (
                        <div key={i} className={`tree-node ${node.is_file ? 'tree-file' : 'tree-dir'} ${isHighlighted ? 'tree-node-match' : filterModeActive ? 'tree-node-context' : ''}`}
                            style={{ paddingLeft: `${node.depth * 20 + 12}px` }}>
                            {!node.is_file ? (
                                <button className="tree-toggle" onClick={() => toggleCollapse(node.path)}>
                                    {collapsed.has(node.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                            ) : <span className="tree-toggle-spacer" />}
                            {node.is_file ? <File size={14} className="tree-icon" /> : <Folder size={14} className="tree-icon icon-primary" />}
                            <span className="tree-name">{node.name}</span>
                            {!node.is_file && dirMeta && filterModeActive && (
                                <>
                                    <span className="tree-meta">{dirMeta.fileCount} files</span>
                                    {isHighlighted && <span className="tree-match-tag">match</span>}
                                    {isHighlighted && dirMeta.extSummary && <span className="tree-ext">{dirMeta.extSummary}</span>}
                                </>
                            )}
                            {node.size > 0 && <span className="tree-size">{formatSize(node.size)}</span>}
                            {node.ext && <span className="tree-ext">{node.ext}</span>}
                        </div>
                    )})}
                    {visibleTree.visibleNodes.length > 500 && <p className="more-text" style={{ padding: '12px 20px' }}>Showing 500/{visibleTree.visibleNodes.length}</p>}
                </div>
            )}
        </>
    );
}

// ===================== Cleanup =====================

function CleanupPage({ showToast }) {
    const [mode, setMode] = useState('rename');
    const [baseDir, setBaseDir] = useState('/data');
    const [pattern, setPattern] = useState('');
    const [replacement, setReplacement] = useState('');
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [quarantineData, setQuarantineData] = useState(null);
    const [restoreLoading, setRestoreLoading] = useState(false);
    const [restoreBatch, setRestoreBatch] = useState('');
    const [restoreSelection, setRestoreSelection] = useState(new Set());

    const handlePreview = () => {
        if (mode === 'quarantine') {
            setLoading(true);
            fetch(`${API}/api/quarantine`)
                .then(r => r.json())
                .then(d => { d.error ? showToast(d.error) : setQuarantineData(d); setLoading(false); })
                .catch(() => { showToast('Failed to load quarantine'); setLoading(false); });
            return;
        }
        if (!pattern) { showToast('Pattern is required'); return; }
        setLoading(true); setPreview(null);
        const endpoint = mode === 'rename' ? '/api/preview-rename' : '/api/preview-delete';
        const body = mode === 'rename' ? { base_dir: baseDir, pattern, replacement } : { base_dir: baseDir, pattern };
        fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json()).then(d => { d.error ? showToast(d.error) : setPreview(d); setLoading(false); })
            .catch(() => { showToast('Preview failed'); setLoading(false); });
    };

    const handleExecute = () => {
        if (!preview?.matches?.length) return;
        setExecuting(true);
        const endpoint = mode === 'rename' ? '/api/execute-rename' : '/api/execute-delete';
        fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations: preview.matches }) })
            .then(r => r.json()).then(d => {
                showToast(`Done: ${d.success} ok${d.failed ? `, ${d.failed} failed` : ''}${d.freed_bytes ? `, freed ${formatSize(d.freed_bytes)}` : ''}`, d.failed ? 'error' : 'success');
                setPreview(null); setExecuting(false);
            }).catch(() => { showToast('Execute failed'); setExecuting(false); });
    };

    const toggleRestoreItem = (path) => {
        setRestoreSelection(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const handleRestore = () => {
        if (!restoreBatch || restoreSelection.size === 0) {
            showToast('Select a batch and items');
            return;
        }
        setRestoreLoading(true);
        const entries = Array.from(restoreSelection).map(path => ({ path }));
        fetch(`${API}/api/quarantine/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: restoreBatch, entries }),
        }).then(r => r.json()).then(d => {
            if (d.error) { showToast(d.error); return; }
            showToast(`Restored ${d.success}${d.failed ? `, failed ${d.failed}` : ''}${d.restored_bytes ? `, ${formatSize(d.restored_bytes)}` : ''}`, d.failed ? 'error' : 'success');
            setRestoreSelection(new Set());
            handlePreview();
        }).catch(() => showToast('Restore failed'))
            .finally(() => setRestoreLoading(false));
    };

    return (
        <>
            <header className="topbar"><h1>Batch Cleanup</h1></header>
            <div className="tab-bar">
                <button className={`tab ${mode === 'rename' ? 'active' : ''}`} onClick={() => { setMode('rename'); setPreview(null); }}><Edit3 size={16} /> Regex Rename</button>
                <button className={`tab ${mode === 'delete' ? 'active' : ''}`} onClick={() => { setMode('delete'); setPreview(null); }}><Trash2 size={16} /> Regex Delete</button>
                <button className={`tab ${mode === 'quarantine' ? 'active' : ''}`} onClick={() => { setMode('quarantine'); setPreview(null); }}><FolderOpen size={16} /> Quarantine</button>
            </div>
            <div className="card" style={{ marginBottom: '20px' }}>
                <div className="form-grid">
                    <div className="form-group"><label>Base Directory</label><input className="scan-input" value={baseDir} onChange={e => setBaseDir(e.target.value)} /></div>
                    {mode !== 'quarantine' && (
                        <div className="form-group"><label>Regex Pattern</label><input className="scan-input" value={pattern} onChange={e => setPattern(e.target.value)} placeholder={mode === 'rename' ? 'e.g. ^(.+)-C$' : 'e.g. \\.DS_Store$'} /></div>
                    )}
                    {mode === 'rename' && <div className="form-group"><label>Replacement</label><input className="scan-input" value={replacement} onChange={e => setReplacement(e.target.value)} placeholder='e.g. \\1' /></div>}
                </div>
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                    {mode !== 'quarantine' && (
                        <button className="btn-primary" onClick={handlePreview} disabled={loading}><Search size={16} /> {loading ? 'Searching...' : 'Preview'}</button>
                    )}
                    {mode === 'quarantine' && (
                        <button className="btn-primary" onClick={handlePreview} disabled={loading}><FolderOpen size={16} /> {loading ? 'Loading...' : 'Load Quarantine'}</button>
                    )}
                    {mode !== 'quarantine' && preview?.matches?.length > 0 && (
                        <button className="btn-danger" onClick={handleExecute} disabled={executing}><CheckCircle size={16} /> {executing ? 'Executing...' : `Execute (${preview.matches.length})`}</button>
                    )}
                </div>
            </div>
            {preview && mode !== 'quarantine' && (
                <div className="card">
                    <h3>Preview <span className="count">({preview.count}{preview.total_size ? `, ${formatSize(preview.total_size)}` : ''})</span></h3>
                    {preview.matches.length === 0 ? <p className="empty-text">No matches.</p> : (
                        <div className="preview-table-wrap">
                            <table className="preview-table">
                                <thead><tr>{mode === 'rename' ? <><th>Original</th><th>→</th><th>New</th></> : <><th>Path</th><th>Type</th><th>Size</th></>}</tr></thead>
                                <tbody>{preview.matches.slice(0, 100).map((m, i) => <tr key={i}>{mode === 'rename' ? <><td className="path-cell">{m.old_name}</td><td style={{ textAlign: 'center', color: 'var(--primary)' }}>→</td><td className="path-cell highlight">{m.new_name}</td></> : <><td className="path-cell">{m.path}</td><td><span className="tag">{m.type}</span></td><td>{formatSize(m.size)}</td></>}</tr>)}</tbody>
                            </table>
                            {preview.matches.length > 100 && <p className="more-text" style={{ padding: '12px' }}>...+{preview.matches.length - 100} more</p>}
                        </div>
                    )}
                </div>
            )}
            {mode === 'quarantine' && (
                <div className="card">
                    <h3>Quarantine Batches</h3>
                    {!quarantineData ? (
                        <p className="empty-text">Load quarantine to view items.</p>
                    ) : quarantineData.batches?.length === 0 ? (
                        <p className="empty-text">No quarantine batches found.</p>
                    ) : (
                        <>
                            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                                <div className="form-group">
                                    <label>Select Batch</label>
                                    <select
                                        className="scan-input"
                                        value={restoreBatch}
                                        onChange={e => { setRestoreBatch(e.target.value); setRestoreSelection(new Set()); }}
                                    >
                                        <option value="">Choose a batch</option>
                                        {quarantineData.batches.map(batch => (
                                            <option key={batch.batch} value={batch.batch}>{batch.batch}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {restoreBatch && (
                                <>
                                    <div className="preview-table-wrap" style={{ marginTop: '10px' }}>
                                        <table className="preview-table">
                                            <thead><tr><th></th><th>Path</th><th>Type</th><th>Size</th></tr></thead>
                                            <tbody>
                                                {(quarantineData.batches.find(b => b.batch === restoreBatch)?.items || []).slice(0, 200).map((item, i) => (
                                                    <tr key={`${item.path}-${i}`}>
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreSelection.has(item.path)}
                                                                onChange={() => toggleRestoreItem(item.path)}
                                                            />
                                                        </td>
                                                        <td className="path-cell">{item.path}</td>
                                                        <td><span className="tag">{item.type}</span></td>
                                                        <td>{item.size ? formatSize(item.size) : '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                                        <button className="btn-primary" onClick={handleRestore} disabled={restoreLoading}>
                                            <CheckCircle size={16} /> {restoreLoading ? 'Restoring...' : `Restore (${restoreSelection.size})`}
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}

// ===================== Settings =====================

function SettingsPage({ showToast }) {
    const [cfg, setCfg] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API}/api/config`).then(r => r.json()).then(d => { setCfg(d); setLoading(false); })
            .catch(() => { showToast('Failed to load config'); setLoading(false); });
    }, [showToast]);

    const handleSave = () => {
        fetch(`${API}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
            .then(r => r.json()).then(d => { d.error ? showToast(d.error) : showToast('Saved', 'success'); })
            .catch(() => showToast('Failed'));
    };

    if (loading) return <LoadingInline />;
    return (
        <>
            <header className="topbar"><h1>Settings</h1></header>
            <div className="card" style={{ maxWidth: '600px' }}>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="form-group"><label>Default Data Directory</label>
                        <input className="scan-input" value={cfg?.data_dir || ''} onChange={e => setCfg({ ...cfg, data_dir: e.target.value })} /></div>
                    <div className="form-group"><label>Tree Cache Directory</label>
                        <input className="scan-input" value={cfg?.tree_dir || ''} disabled style={{ opacity: 0.5 }} /></div>
                    <div className="form-group"><label>Quarantine Directory</label>
                        <input className="scan-input" value={cfg?.quarantine_dir || ''} onChange={e => setCfg({ ...cfg, quarantine_dir: e.target.value })} /></div>
                </div>
                <div style={{ marginTop: '20px' }}><button className="btn-primary" onClick={handleSave}><Save size={16} /> Save</button></div>
            </div>
        </>
    );
}

// ===================== Shared =====================

function StatCard({ title, value, icon, color }) {
    return (<div className={`stat-card color-${color}`}><div className="stat-icon">{icon}</div><div className="stat-info"><h3>{value}</h3><p>{title}</p></div></div>);
}

function DetailCard({ title, items = [], renderItem, limit = 20 }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? items : items.slice(0, limit);
    return (
        <div className="card">
            <h3>{title} <span className="count">({items.length})</span></h3>
            <ul className="file-list">
                {shown.map((item, i) => <li key={i}>{renderItem(item)}</li>)}
                {items.length === 0 && <li className="empty-text">None ✓</li>}
            </ul>
            {items.length > limit && <button className="btn-link" onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : `All ${items.length}`}</button>}
        </div>
    );
}

function LinkInsightsCard({ data, loading, onBrowsePath }) {
    const hardlinks = data?.hardlinks || [];
    const symlinks = data?.symlinks || [];

    return (
        <div className="card">
            <h3>Hardlink / Symlink <span className="count">({data ? `${hardlinks.length} / ${symlinks.length}` : '0 / 0'})</span></h3>
            {loading ? <p className="empty-text">Analyzing links...</p> : !data ? <p className="empty-text">No link analysis data yet.</p> : (
                <>
                    <div className="link-summary">
                        <span className="tag">{data.hardlink_groups || 0} hardlink groups</span>
                        <span className="tag">{formatSize(data.saved_bytes || 0)} saved</span>
                        <span className="tag">{data.broken_symlinks || 0} broken symlinks</span>
                        {data.cross_dir_groups > 0 && <span className="tag">{data.cross_dir_groups} cross-dir groups</span>}
                    </div>

                    <p className="link-subtitle">Hardlink Groups (Top 8)</p>
                    <ul className="file-list">
                        {hardlinks.slice(0, 8).map((group, i) => (
                            <li key={`hardlink-${i}`}>
                                <HardDrive size={14} className="icon-green" />
                                <span className="path-text" title={group.paths?.[0] || ''}>{group.paths?.[0] || '(unknown)'}</span>
                                <span className="tag">{group.count} links</span>
                                {group.cross_dir && <span className="tag">cross-dir</span>}
                                <button
                                    type="button"
                                    className="btn-link-inline"
                                    onClick={() => {
                                        const target = parentPath(group.paths?.[0] || '');
                                        if (target) onBrowsePath(target);
                                    }}
                                >
                                    Browse
                                </button>
                            </li>
                        ))}
                        {hardlinks.length === 0 && <li className="empty-text">No hardlink groups found.</li>}
                    </ul>

                    <p className="link-subtitle">Symlinks (Top 8)</p>
                    <ul className="file-list">
                        {symlinks.slice(0, 8).map((link, i) => (
                            <li key={`symlink-${i}`}>
                                <FolderSearch size={14} className={link.broken ? 'icon-red' : 'icon-blue'} />
                                <ResultPathRow path={link.path} type={link.is_dir ? 'dir' : 'file'} onBrowsePath={onBrowsePath} />
                                {link.broken && <span className="tag">broken</span>}
                            </li>
                        ))}
                        {symlinks.length === 0 && <li className="empty-text">No symlinks found.</li>}
                    </ul>
                </>
            )}
        </div>
    );
}

function ResultPathRow({ path, type = 'dir', onBrowsePath }) {
    const target = type === 'file' ? parentPath(path) : path;
    return (
        <span className="path-row">
            <span className="path-text" title={path}>{path}</span>
            <button
                type="button"
                className="btn-link-inline"
                onClick={() => target && onBrowsePath(target)}
                disabled={!target}
            >
                Browse
            </button>
        </span>
    );
}

const TREE_PRESET_KEY = 'tree_filter_presets_v1';

function loadTreePresets() {
    try {
        const raw = window.localStorage.getItem(TREE_PRESET_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveTreePreset(name, payload) {
    const next = loadTreePresets()
        .filter(p => p.name !== name)
        .concat([{ name, ...payload }])
        .sort((a, b) => a.name.localeCompare(b.name));
    window.localStorage.setItem(TREE_PRESET_KEY, JSON.stringify(next));
    return next;
}

function deleteTreePreset(name) {
    const next = loadTreePresets().filter(p => p.name !== name);
    window.localStorage.setItem(TREE_PRESET_KEY, JSON.stringify(next));
    return next;
}

const TREE_VIDEO_EXTS = new Set([
    '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv',
    '.m2ts', '.iso', '.rmvb', '.ts', '.m4v', '.mpg',
    '.mpeg', '.webm', '.vob', '.3gp',
]);
const TREE_ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz']);
const METADATA_FILTER_PRESET = 'jpg,jpeg,png,nfo,txt,srt,ass';

function buildTreeDirectoryIndex(nodes) {
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

function applyTreeCollapse(nodes, collapsed) {
    const visibleNodes = [];
    const hiddenPrefixes = new Set();
    for (const node of nodes) {
        let hidden = false;
        for (const prefix of hiddenPrefixes) {
            if (node.path.startsWith(prefix + '/')) {
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

function addPathWithAncestors(path, parentMap, targetSet) {
    let current = path;
    while (current) {
        if (targetSet.has(current)) break;
        targetSet.add(current);
        current = parentMap.get(current) || '';
    }
}

function matchesNodeQuery(node, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
}

function parseExtensionList(value) {
    return value
        .split(',')
        .map(item => normalizeExt(item))
        .filter(Boolean);
}

function normalizeExt(value) {
    const clean = String(value || '').trim().toLowerCase().replace(/^\.+/, '');
    return clean ? `.${clean}` : '';
}

function summarizeExtCounts(extCounts, limit = 3) {
    const entries = Array.from(extCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
    if (entries.length === 0) return '';
    const summary = entries.map(([ext]) => ext || '(no ext)').join(', ');
    return extCounts.size > limit ? `${summary}, +${extCounts.size - limit}` : summary;
}

function parseLevelFilter(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseSizeInput(value) {
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

function LoadingInline() { return <div className="loading-state-inline"><div className="spinner"></div><p>Loading...</p></div>; }
function EmptyState({ message }) { return <div className="empty-state"><AlertTriangle size={48} className="icon-orange" /><h2>No Data</h2><p>{message}</p></div>; }
function formatSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

function parentPath(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return '';
    const idx = normalized.lastIndexOf('/');
    if (idx <= 0) return normalized;
    return normalized.slice(0, idx);
}
