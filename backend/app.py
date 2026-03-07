"""FileAnalyzer Backend - Flask API serving analysis results and triggering scans."""

import os
import subprocess
import csv
import io
import hashlib

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from scanner import FileScanner
from operations import BatchOps

app = Flask(__name__, static_folder='dist', static_url_path='/')
CORS(app)

# Configuration via environment variables
TREE_DIR = os.environ.get('TREE_DIR', '/data/.fileanalyzer')
DATA_DIR = os.environ.get('DATA_DIR', '/data')

os.makedirs(TREE_DIR, exist_ok=True)


def _tree_file_for(scan_path):
    """Get a unique tree cache file path for a given scan directory."""
    path_hash = hashlib.md5(scan_path.encode()).hexdigest()[:12]
    safe_name = os.path.basename(scan_path.rstrip('/')) or 'root'
    return os.path.join(TREE_DIR, f'{safe_name}_{path_hash}.txt')


def _current_tree_file():
    """Find the most recently modified tree file, or None."""
    if not os.path.isdir(TREE_DIR):
        return None
    files = [os.path.join(TREE_DIR, f) for f in os.listdir(TREE_DIR) if f.endswith('.txt')]
    return max(files, key=os.path.getmtime) if files else None


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
    results['scan_path'] = scan_path or 'latest'
    return jsonify(results)


@app.route('/api/tree', methods=['GET'])
def tree_view():
    """Return the raw parsed directory tree as a nested structure."""
    scan_path = request.args.get('path', '')
    tree_file = _tree_file_for(scan_path) if scan_path else _current_tree_file()
    if not tree_file or not os.path.exists(tree_file):
        return jsonify({"error": "No tree data. Run a scan first."}), 404

    scanner = FileScanner(tree_file)
    nodes = []
    path_stack = []
    with open(tree_file, 'r', encoding='utf-8') as f:
        for line in f:
            parsed = scanner._parse_line(line)
            if parsed is None:
                continue
            depth, name, size_bytes = parsed
            while path_stack and path_stack[-1][0] >= depth:
                path_stack.pop()
            path_stack.append((depth, name))
            full_path = '/'.join(item[1] for item in path_stack)
            ext = os.path.splitext(name)[1].lower()
            nodes.append({
                "depth": depth, "name": name, "path": full_path,
                "size": size_bytes, "is_file": bool(ext), "ext": ext,
            })
    return jsonify({"nodes": nodes, "total": len(nodes)})


@app.route('/api/generate', methods=['POST'])
def generate():
    """Generate a new tree file by scanning a directory using the `tree` command."""
    data = request.json or {}
    scan_path = data.get('path', DATA_DIR).strip() or DATA_DIR

    if not os.path.isdir(scan_path):
        return jsonify({"error": f"Directory not found: {scan_path}"}), 400

    tree_file = _tree_file_for(scan_path)
    try:
        cmd = ['tree', '--du', '-h', '--charset=utf8', scan_path]
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            check=True, encoding='utf-8', timeout=300,
        )
        with open(tree_file, 'w', encoding='utf-8') as f:
            f.write(result.stdout)
        return jsonify({
            "status": "success",
            "message": f"Scanned {scan_path} successfully",
            "path": scan_path,
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Scan timed out (>5 min). Try a smaller directory."}), 504
    except subprocess.CalledProcessError as e:
        return jsonify({"error": f"tree command failed: {e.stderr}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
    result = BatchOps.execute_delete(operations)
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
    browse_path = request.args.get('path', DATA_DIR)
    if not os.path.isdir(browse_path):
        return jsonify({"error": f"Not a directory: {browse_path}"}), 400

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

    parent = os.path.dirname(browse_path.rstrip('/'))
    return jsonify({
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
                # Read first line to get original scan path
                with open(fpath, 'r', encoding='utf-8') as fh:
                    first_line = fh.readline().strip()
                scans.append({
                    "file": f,
                    "path": fpath,
                    "first_line": first_line,
                    "modified": os.path.getmtime(fpath),
                    "size": os.path.getsize(fpath),
                })
    return jsonify({"scans": scans})


@app.route('/api/config', methods=['GET', 'POST'])
def config():
    """Get or update runtime configuration."""
    global DATA_DIR
    if request.method == 'GET':
        return jsonify({
            "tree_dir": TREE_DIR,
            "data_dir": DATA_DIR,
        })

    data = request.json or {}
    if 'data_dir' in data:
        DATA_DIR = data['data_dir']
    return jsonify({"status": "updated", "data_dir": DATA_DIR})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') != 'production'
    app.run(host='0.0.0.0', debug=debug, port=port)
