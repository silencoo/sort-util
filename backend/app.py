# pyre-ignore-all-errors
"""FileAnalyzer Backend - Flask API serving analysis results and triggering scans."""

import os
import subprocess
import csv
import io
import hashlib
from typing import List, Dict, Tuple, Any, Optional, cast

from flask import Flask, jsonify, request, Response  # type: ignore
from flask_cors import CORS  # type: ignore
from scanner import FileScanner  # type: ignore
from operations import BatchOps  # type: ignore
from links import analyze_links  # type: ignore

app = Flask(__name__, static_folder='dist', static_url_path='/')
CORS(app)

def _ensure_directory(primary_path, fallback_path):
    """Ensure a directory exists, falling back if primary is unavailable."""
    try:
        os.makedirs(primary_path, exist_ok=True)
        return primary_path
    except OSError:
        os.makedirs(fallback_path, exist_ok=True)
        return fallback_path


BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LOCAL_DATA_DIR = os.path.join(BASE_DIR, 'data')
DATA_DIR = _ensure_directory(os.environ.get('DATA_DIR', '/data'), LOCAL_DATA_DIR)
TREE_DIR = _ensure_directory(
    os.environ.get('TREE_DIR', os.path.join(DATA_DIR, '.fileanalyzer')),
    os.path.join(LOCAL_DATA_DIR, '.fileanalyzer'),
)
QUARANTINE_DIR = _ensure_directory(
    os.environ.get('QUARANTINE_DIR', os.path.join(DATA_DIR, '.quarantine')),
    os.path.join(LOCAL_DATA_DIR, '.quarantine'),
)


def _tree_file_for(scan_path):
    """Get a unique tree cache file path for a given scan directory."""
    h = str(hashlib.md5(scan_path.encode()).hexdigest())
    path_hash = ''.join(h[i] for i in range(12)) if len(h) >= 12 else h
    safe_name = os.path.basename(scan_path.rstrip('/')) or 'root'
    return os.path.join(TREE_DIR, f'{safe_name}_{path_hash}.txt')


def _current_tree_file():
    """Find the most recently modified tree file, or None."""
    if not os.path.isdir(TREE_DIR):
        return None
    files = [os.path.join(TREE_DIR, f) for f in os.listdir(TREE_DIR) if f.endswith('.txt')]
    return max(files, key=os.path.getmtime) if files else None


def _extract_scan_root(tree_file='', first_line=None):
    """Extract the root path from a cached tree file or its first line."""
    scanner = FileScanner(tree_file or '')
    if first_line is not None:
        parsed = scanner._parse_line(first_line)
        if parsed is None:
            return ''
        depth, name, _ = parsed
        return name if depth == 0 else ''

    with open(tree_file, 'r', encoding='utf-8') as fh:
        for line in fh:
            parsed = scanner._parse_line(line)
            if parsed is None:
                continue
            depth, name, _ = parsed
            if depth == 0:
                return name
    return ''


def _scan_metadata(tree_file, first_line=''):
    """Build user-facing metadata for a cached scan file."""
    stat = os.stat(tree_file)
    root_path = _extract_scan_root(tree_file, first_line=first_line)
    display_name = os.path.basename(root_path.rstrip('/')) or root_path or os.path.basename(tree_file)
    return {
        "file": os.path.basename(tree_file),
        "cache_path": tree_file,
        "scan_path": root_path,
        "display_name": display_name,
        "modified": stat.st_mtime,
        "cache_size": stat.st_size,
    }


def _resolve_browse_path(raw_path):
    """Resolve a browse target to an existing directory when possible."""
    raw = (raw_path or '').strip() or DATA_DIR

    # Map docker-style /data paths to current DATA_DIR when running outside docker.
    posix_raw = str(raw).replace('\\', '/')
    if DATA_DIR and DATA_DIR != '/data' and (posix_raw == '/data' or posix_raw.startswith('/data/')):
        suffix = posix_raw.replace('/data', '', 1).lstrip('/')
        raw = os.path.join(DATA_DIR, suffix) if suffix else DATA_DIR

    candidate = os.path.abspath(raw)

    # If the target is an existing file, browse its parent directory.
    if os.path.isfile(candidate):
        parent = os.path.dirname(candidate)
        return parent or candidate

    # Walk up to find the nearest existing directory.
    probe = candidate
    while probe and not os.path.isdir(probe):
        parent = os.path.dirname(probe.rstrip('/\\'))
        if not parent or parent == probe:
            break
        probe = parent

    if os.path.isdir(probe):
        return probe
    return candidate


def _format_size(size_bytes):
    """Format bytes into tree's exact human-readable size format (e.g. ' 4.0K', '  566G')."""
    if size_bytes == 0:
        return '    0 '
    units = ['B', 'K', 'M', 'G', 'T']
    idx = 0
    val = float(size_bytes)
    while val >= 1024 and idx < len(units) - 1:
        val /= 1024.0
        idx += 1
    
    if idx == 0:
        s = f"{int(val)}"
    else:
        s = f"{val:.1f}"
        if s.endswith('.0') and len(s) > 3:
            s = s.removesuffix('.0')
    
    s += units[idx]
    return s.rjust(5)


def _generate_tree_file(scan_path, output_file):
    """
    Generate a tree file manually using Python to match `tree --du -h` exactly.
    Returns error message or None on success.
    """
    try:
        if not os.path.exists(scan_path):
            return f"Path not found: {scan_path}"
        
        # 1. Walk tree to calculate directory sizes first
        dir_sizes = {}
        file_tree = {} # dir -> list of (name, is_dir, size)
        
        for root, dirs, files in os.walk(scan_path):
            # Sort to match tree output
            items = []
            for d in sorted(dirs, key=lambda x: x.lower()):
                items.append((d, True, 0))
            for f in sorted(files, key=lambda x: x.lower()):
                try:
                    size = os.path.getsize(os.path.join(root, f))
                except OSError:
                    size = 0
                items.append((f, False, size))
            file_tree[root] = items

        def calc_sizes(current_path):
            total = 0
            if current_path in file_tree:
                for item_name, is_dir, fsize in file_tree[current_path]:
                    if is_dir:
                        total += calc_sizes(os.path.join(current_path, item_name))
                    else:
                        total += fsize
            dir_sizes[current_path] = total
            return total
            
        root_size = calc_sizes(scan_path)
        
        # 2. Render tree
        with open(output_file, 'w', encoding='utf-8') as f:
            # Root
            f.write(f"[{_format_size(root_size)}]  {scan_path}\n")
            
            def render_dir(current_path, deeper_prefix):
                items = file_tree.get(current_path, [])
                for i, (name, is_dir, fsize) in enumerate(items):
                    is_last = (i == len(items) - 1)
                    connector = "└── " if is_last else "├── "
                    child_prefix = "    " if is_last else "│   "
                    
                    if is_dir:
                        dpath = os.path.join(current_path, name)
                        dsize = dir_sizes.get(dpath, 0)
                        f.write(f"[{_format_size(dsize)}]  {deeper_prefix}{connector}{name}\n")
                        render_dir(dpath, deeper_prefix + child_prefix)
                    else:
                        f.write(f"[{_format_size(fsize)}]  {deeper_prefix}{connector}{name}\n")
            
            render_dir(scan_path, "")
            
        return None
    except Exception as e:
        return str(e)


# -------- Static File Serving --------

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return app.send_static_file(path)
    return app.send_static_file('index.html')


# -------- API Endpoints --------

@app.route('/api/analyze', methods=['GET'])
def analyze():
    """Analyze a tree file. Pass ?path=/some/dir to pick a specific scan."""
    scan_path = request.args.get('path', '')
    if scan_path:
        tree_file = _tree_file_for(scan_path)
    else:
        tree_file = _current_tree_file()
    if not tree_file or not os.path.exists(tree_file):
        return jsonify({"error": "No scan data found. Run a scan first."}), 404
    scanner = FileScanner(tree_file)
    results = scanner.scan()
    results['scan_path'] = scan_path or _extract_scan_root(tree_file) or 'latest'
    return jsonify(results)


@app.route('/api/tree', methods=['GET'])
def tree_view():
    """Return the raw parsed directory tree as a nested structure."""
    scan_path = request.args.get('path', '')
    tree_file = _tree_file_for(scan_path) if scan_path else _current_tree_file()
    if not tree_file or not os.path.exists(tree_file):
        return jsonify({"error": "No tree data. Run a scan first."}), 404

    scanner = FileScanner(tree_file)
    nodes: List[Dict[str, Any]] = []
    path_stack = []
    with open(tree_file, 'r', encoding='utf-8') as f:
        for line in f:
            parsed = scanner._parse_line(line)
            if parsed is None:
                continue
            depth, name, size_bytes = parsed
            while path_stack:
                top_depth, _ = cast(Tuple[int, str], path_stack[-1])
                if top_depth >= depth:
                    path_stack.pop()
                else:
                    break
            path_stack.append((depth, name))
            full_path = '/'.join(n for _, n in path_stack)
            ext = os.path.splitext(name)[1].lower()
            nodes.append({
                "depth": depth, "name": name, "path": full_path,
                "size": size_bytes, "is_file": bool(ext), "ext": ext,
            })
    return jsonify({"nodes": nodes, "total": len(nodes), "scan_path": scan_path or _extract_scan_root(tree_file)})


@app.route('/api/generate', methods=['POST'])
def generate():
    """Generate a new tree file by scanning a directory using the `tree` command."""
    data = request.json or {}
    raw_path = data.get('path', DATA_DIR)
    scan_path = str(raw_path if raw_path is not None else DATA_DIR).strip() or DATA_DIR

    if not os.path.isdir(scan_path):
        return jsonify({"error": f"Directory not found: {scan_path}"}), 400

    tree_file = _tree_file_for(scan_path)
    err = _generate_tree_file(scan_path, tree_file)
    if err:
        return jsonify({"error": f"Failed to generate tree: {err}"}), 500

    return jsonify({
        "status": "success",
        "message": f"Scanned {scan_path} successfully",
        "path": scan_path,
    })


@app.route('/api/links', methods=['GET'])
def links_view():
    """Analyze hardlinks and symlinks for a directory tree."""
    scan_path = request.args.get('path', DATA_DIR).strip() or DATA_DIR
    max_depth = request.args.get('max_depth', '12')
    try:
        max_depth = max(1, min(int(max_depth), 64))
    except ValueError:
        return jsonify({"error": "max_depth must be an integer"}), 400

    result = analyze_links(scan_path, max_depth=max_depth)
    if 'error' in result:
        return jsonify(result), 400
    result['scan_path'] = scan_path
    return jsonify(result)


# -------- Batch Operations --------

@app.route('/api/preview-rename', methods=['POST'])
def preview_rename():
    """Preview regex rename results without executing."""
    data = request.json or {}
    base_dir = data.get('base_dir', DATA_DIR)
    pattern = data.get('pattern', '')
    replacement = data.get('replacement', '')
    file_filter = data.get('filter')  # 'files', 'dirs', or None

    if not pattern:
        return jsonify({"error": "Pattern is required"}), 400

    results = BatchOps.preview_rename(base_dir, pattern, replacement, file_filter)
    if isinstance(results, dict) and 'error' in results:
        return jsonify(results), 400
    return jsonify({"matches": results, "count": len(results)})


@app.route('/api/execute-rename', methods=['POST'])
def execute_rename():
    """Execute rename operations from a confirmed preview list."""
    data = request.json or {}
    operations = data.get('operations', [])
    if not operations:
        return jsonify({"error": "No operations provided"}), 400
    result = BatchOps.execute_rename(operations)
    return jsonify(result)


@app.route('/api/preview-delete', methods=['POST'])
def preview_delete():
    """Preview delete results without executing."""
    data = request.json or {}
    base_dir = data.get('base_dir', DATA_DIR)
    pattern = data.get('pattern')
    paths = data.get('paths')

    if not pattern and not paths:
        return jsonify({"error": "Pattern or paths required"}), 400

    results = BatchOps.preview_delete(base_dir, pattern, paths)
    if isinstance(results, dict) and 'error' in results:
        return jsonify(results), 400

    total_size = sum(r.get('size', 0) for r in results)
    return jsonify({"matches": results, "count": len(results), "total_size": total_size})


@app.route('/api/execute-delete', methods=['POST'])
def execute_delete():
    """Execute delete operations from a confirmed preview list."""
    data = request.json or {}
    operations = data.get('operations', [])
    if not operations:
        return jsonify({"error": "No operations provided"}), 400
    mode = data.get('mode', 'delete')
    root_hint = data.get('root_hint')
    if mode == 'quarantine':
        result = BatchOps.execute_quarantine(operations, QUARANTINE_DIR, root_hint=root_hint)
    else:
        result = BatchOps.execute_delete(operations)
    return jsonify(result)


@app.route('/api/quarantine', methods=['GET'])
def quarantine_list():
    """List quarantine batches and items."""
    return jsonify(BatchOps.list_quarantine(QUARANTINE_DIR))


@app.route('/api/quarantine/restore', methods=['POST'])
def quarantine_restore():
    """Restore selected entries from a quarantine batch."""
    data = request.json or {}
    batch = data.get('batch')
    entries = data.get('entries', [])
    restore_root = data.get('restore_root')
    if not batch or not entries:
        return jsonify({"error": "Batch and entries required"}), 400
    batch_path = os.path.join(QUARANTINE_DIR, str(batch))
    result = BatchOps.restore_quarantine(batch_path, entries, restore_root=restore_root)
    return jsonify(result)


@app.route('/api/export', methods=['GET'])
def export():
    """Export analysis results as CSV or JSON."""
    fmt = request.args.get('format', 'json')
    scan_path = request.args.get('path', '')
    tree_file = _tree_file_for(scan_path) if scan_path else _current_tree_file()
    if not tree_file or not os.path.exists(tree_file):
        return jsonify({"error": "No scan data"}), 404
    scanner = FileScanner(tree_file)
    results = scanner.scan()
    if 'error' in results:
        return jsonify(results), 400

    if fmt == 'csv':
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['category', 'path', 'size', 'detail'])
        for item in results.get('empty_dirs', []):
            writer.writerow(['empty_dir', item.get('path', ''), item.get('size', 0), ''])
        for item in results.get('only_metadata', []):
            writer.writerow(['metadata_only', item.get('path', ''), item.get('size', 0), f"{item.get('file_count', 0)} files"])
        for item in results.get('no_videos', []):
            writer.writerow(['no_video', item.get('path', ''), item.get('size', 0), ''])
        for item in results.get('garbage_files', []):
            writer.writerow(['garbage', item.get('path', ''), item.get('size', 0), item.get('reason', '')])
        for item in results.get('bt_junk_files', []):
            writer.writerow(['bt_junk', item.get('path', ''), item.get('size', 0), ''])
        for item in results.get('has_archives', []):
            writer.writerow(['archive', item.get('path', ''), '', ','.join(item.get('archives', []))])
        return Response(output.getvalue(), mimetype='text/csv',
                        headers={'Content-Disposition': 'attachment; filename=analysis.csv'})
    else:
        return jsonify(results)


@app.route('/api/browse', methods=['GET'])
def browse():
    """List directories and files at a given path for the folder browser."""
    requested_path = request.args.get('path', DATA_DIR)
    browse_path = _resolve_browse_path(requested_path)
    if not os.path.isdir(browse_path):
        return jsonify({"error": f"Not a directory: {requested_path}"}), 400

    items = []
    try:
        for entry in sorted(os.scandir(browse_path), key=lambda e: (not e.is_dir(), e.name.lower())):
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                size = 0 if is_dir else entry.stat().st_size
                items.append({
                    "name": entry.name,
                    "path": entry.path,
                    "is_dir": is_dir,
                    "size": size,
                })
            except (PermissionError, OSError):
                continue
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403

    # Check which subdirs already have scan cache
    scanned = set()
    if os.path.isdir(TREE_DIR):
        for f in os.listdir(TREE_DIR):
            if f.endswith('.txt'):
                scanned.add(os.path.join(TREE_DIR, f))

    for item in items:
        if item['is_dir']:
            cache = _tree_file_for(item['path'])
            item['has_scan'] = cache in scanned

    parent = os.path.dirname(str(browse_path).rstrip('/'))
    return jsonify({
        "requested": requested_path,
        "current": browse_path,
        "parent": parent if parent != browse_path else None,
        "items": items,
    })


@app.route('/api/scans', methods=['GET'])
def list_scans():
    """List all cached scan results."""
    scans = []
    if os.path.isdir(TREE_DIR):
        for f in sorted(os.listdir(TREE_DIR), key=lambda x: os.path.getmtime(os.path.join(TREE_DIR, x)), reverse=True):
            if f.endswith('.txt'):
                fpath = os.path.join(TREE_DIR, f)
                with open(fpath, 'r', encoding='utf-8') as fh:
                    first_line = fh.readline().strip()
                metadata = _scan_metadata(fpath, first_line=first_line)
                metadata["first_line"] = first_line
                scans.append(metadata)
    return jsonify({"scans": scans})


@app.route('/api/config', methods=['GET', 'POST'])
def config():
    """Get or update runtime configuration."""
    global DATA_DIR, QUARANTINE_DIR
    if request.method == 'GET':
        return jsonify({
            "tree_dir": TREE_DIR,
            "data_dir": DATA_DIR,
            "quarantine_dir": QUARANTINE_DIR,
        })

    data = request.json or {}
    if 'data_dir' in data:
        next_data_dir = data['data_dir']
        try:
            os.makedirs(next_data_dir, exist_ok=True)
            DATA_DIR = next_data_dir
        except OSError as e:
            return jsonify({"error": f"Cannot use data_dir '{next_data_dir}': {e}"}), 400
    if 'quarantine_dir' in data:
        next_quarantine_dir = data['quarantine_dir']
        try:
            os.makedirs(next_quarantine_dir, exist_ok=True)
            QUARANTINE_DIR = next_quarantine_dir
        except OSError as e:
            return jsonify({"error": f"Cannot use quarantine_dir '{next_quarantine_dir}': {e}"}), 400
    return jsonify({"status": "updated", "data_dir": DATA_DIR, "quarantine_dir": QUARANTINE_DIR})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') != 'production'
    app.run(host='0.0.0.0', debug=debug, port=port)
