import { useState, useEffect, useCallback } from 'react';
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
    const [filter, setFilter] = useState('');
    const [collapsed, setCollapsed] = useState(new Set());

    useEffect(() => {
        const url = activePath ? `${API}/api/tree?path=${encodeURIComponent(activePath)}` : `${API}/api/tree`;
        fetch(url)
            .then(r => r.json())
            .then(d => { d.error ? (showToast(d.error), setNodes([])) : setNodes(d.nodes || []); setLoading(false); })
            .catch(() => { showToast('Failed to load tree'); setLoading(false); });
    }, [showToast, activePath]);

    const toggleCollapse = (path) => {
        setCollapsed(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
    };

    const visibleNodes = [];
    const hiddenPrefixes = new Set();
    for (const node of nodes) {
        let hidden = false;
        for (const prefix of hiddenPrefixes) { if (node.path.startsWith(prefix + '/')) { hidden = true; break; } }
        if (hidden) continue;
        if (filter && !node.name.toLowerCase().includes(filter.toLowerCase())) {
            if (!node.is_file) visibleNodes.push(node);
            continue;
        }
        visibleNodes.push(node);
        if (!node.is_file && collapsed.has(node.path)) hiddenPrefixes.add(node.path);
    }

    return (
        <>
            <header className="topbar">
                <h1>Tree View {activePath && <span className="tag">{activePath}</span>}</h1>
                <div className="scan-controls">
                    <input className="scan-input" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." />
                </div>
            </header>
            <div className="summary-bar">
                <span><TreePine size={14} /> {nodes.length} nodes</span><span>•</span>
                <span>{nodes.filter(n => !n.is_file).length} dirs</span><span>•</span>
                <span>{nodes.filter(n => n.is_file).length} files</span>
            </div>
            {loading ? <LoadingInline /> : nodes.length === 0 ? <EmptyState message="No tree data. Run a scan first." /> : (
                <div className="tree-container">
                    {visibleNodes.slice(0, 500).map((node, i) => (
                        <div key={i} className={`tree-node ${node.is_file ? 'tree-file' : 'tree-dir'}`}
                            style={{ paddingLeft: `${node.depth * 20 + 12}px` }}>
                            {!node.is_file ? (
                                <button className="tree-toggle" onClick={() => toggleCollapse(node.path)}>
                                    {collapsed.has(node.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                            ) : <span className="tree-toggle-spacer" />}
                            {node.is_file ? <File size={14} className="tree-icon" /> : <Folder size={14} className="tree-icon icon-primary" />}
                            <span className="tree-name">{node.name}</span>
                            {node.size > 0 && <span className="tree-size">{formatSize(node.size)}</span>}
                            {node.ext && <span className="tree-ext">{node.ext}</span>}
                        </div>
                    ))}
                    {visibleNodes.length > 500 && <p className="more-text" style={{ padding: '12px 20px' }}>Showing 500/{visibleNodes.length}</p>}
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

    const handlePreview = () => {
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

    return (
        <>
            <header className="topbar"><h1>Batch Cleanup</h1></header>
            <div className="tab-bar">
                <button className={`tab ${mode === 'rename' ? 'active' : ''}`} onClick={() => { setMode('rename'); setPreview(null); }}><Edit3 size={16} /> Regex Rename</button>
                <button className={`tab ${mode === 'delete' ? 'active' : ''}`} onClick={() => { setMode('delete'); setPreview(null); }}><Trash2 size={16} /> Regex Delete</button>
            </div>
            <div className="card" style={{ marginBottom: '20px' }}>
                <div className="form-grid">
                    <div className="form-group"><label>Base Directory</label><input className="scan-input" value={baseDir} onChange={e => setBaseDir(e.target.value)} /></div>
                    <div className="form-group"><label>Regex Pattern</label><input className="scan-input" value={pattern} onChange={e => setPattern(e.target.value)} placeholder={mode === 'rename' ? 'e.g. ^(.+)-C$' : 'e.g. \\.DS_Store$'} /></div>
                    {mode === 'rename' && <div className="form-group"><label>Replacement</label><input className="scan-input" value={replacement} onChange={e => setReplacement(e.target.value)} placeholder='e.g. \\1' /></div>}
                </div>
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                    <button className="btn-primary" onClick={handlePreview} disabled={loading}><Search size={16} /> {loading ? 'Searching...' : 'Preview'}</button>
                    {preview?.matches?.length > 0 && <button className="btn-danger" onClick={handleExecute} disabled={executing}><CheckCircle size={16} /> {executing ? 'Executing...' : `Execute (${preview.matches.length})`}</button>}
                </div>
            </div>
            {preview && (
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
