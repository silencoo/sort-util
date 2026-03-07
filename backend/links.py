"""Link Analyzer — detect hardlinks and symlinks across a directory tree.

Approach:
- Walk the directory using os.walk()
- For each file, stat() it to get inode (st_ino), device (st_dev), and link count (st_nlink)
- Files with st_nlink > 1 are hardlinked — group them by (device, inode)
- Symlinks are detected via os.path.islink() and resolved with os.readlink()
"""

import os
from collections import defaultdict


def _in_base(path, base_dir):
    """Check whether path is inside base_dir after resolving real paths."""
    try:
        return os.path.commonpath([os.path.realpath(path), os.path.realpath(base_dir)]) == os.path.realpath(base_dir)
    except ValueError:
        return False


def _top_bucket(path, base_dir):
    """Get first-level bucket relative to base_dir for cross-dir detection."""
    try:
        rel = os.path.relpath(path, base_dir)
    except ValueError:
        return '(outside)'
    if rel in ('.', ''):
        return '(root)'
    if rel.startswith('..'):
        return '(outside)'
    return rel.split(os.sep)[0]


def analyze_links(base_dir, max_depth=10):
    """Analyze hardlinks and symlinks under base_dir.

    Returns:
        dict with 'hardlinks', 'symlinks', and summary stats.
    """
    if not os.path.isdir(base_dir):
        return {"error": f"Not a directory: {base_dir}"}

    base_real = os.path.realpath(base_dir)

    # Track inodes: (dev, ino) -> list of paths
    inode_map = defaultdict(list)
    symlinks = []
    total_files = 0
    errors = []

    for root, dirs, files in os.walk(base_dir):
        # Depth limiter
        depth = root.replace(base_dir, '').count(os.sep)
        if depth >= max_depth:
            dirs.clear()
            continue

        for name in files:
            fpath = os.path.join(root, name)
            total_files += 1

            try:
                # Check symlink first (before stat, which follows links)
                if os.path.islink(fpath):
                    target = os.readlink(fpath)
                    abs_target = os.path.realpath(fpath)
                    broken = not os.path.exists(abs_target)
                    symlinks.append({
                        "path": fpath,
                        "target": target,
                        "abs_target": abs_target,
                        "broken": broken,
                        "outside_base": not _in_base(abs_target, base_real),
                    })
                    continue

                st = os.lstat(fpath)
                if st.st_nlink > 1:
                    inode_map[(st.st_dev, st.st_ino)].append({
                        "path": fpath,
                        "size": st.st_size,
                        "nlink": st.st_nlink,
                    })
            except (PermissionError, OSError) as e:
                errors.append({"path": fpath, "error": str(e)})

        # Also check if directories themselves are symlinks
        for name in list(dirs):
            dpath = os.path.join(root, name)
            if os.path.islink(dpath):
                target = os.readlink(dpath)
                abs_target = os.path.realpath(dpath)
                symlinks.append({
                    "path": dpath,
                    "target": target,
                    "abs_target": abs_target,
                    "broken": not os.path.exists(abs_target),
                    "outside_base": not _in_base(abs_target, base_real),
                    "is_dir": True,
                })
                dirs.remove(name)  # Don't follow symlinked dirs

    # Build hardlink groups (only where we found 2+ paths in our scan)
    hardlink_groups = []
    saved_bytes = 0
    cross_dir_groups = 0
    cross_dir_saved_bytes = 0
    for (dev, ino), entries in inode_map.items():
        if len(entries) >= 2:
            size = entries[0]["size"]
            group_saved_bytes = size * (len(entries) - 1)
            saved_bytes += group_saved_bytes
            paths = [e["path"] for e in entries]
            buckets = sorted({_top_bucket(path, base_dir) for path in paths})
            cross_dir = len(buckets) >= 2
            if cross_dir:
                cross_dir_groups += 1
                cross_dir_saved_bytes += group_saved_bytes
            hardlink_groups.append({
                "inode": ino,
                "size": size,
                "count": len(entries),
                "total_links": entries[0]["nlink"],
                "saved_bytes": group_saved_bytes,
                "cross_dir": cross_dir,
                "top_dirs": buckets,
                "paths": paths,
            })

    # Sort: largest savings first
    hardlink_groups.sort(key=lambda g: g["size"] * (g["count"] - 1), reverse=True)

    return {
        "hardlinks": hardlink_groups,
        "symlinks": symlinks,
        "total_files_scanned": total_files,
        "hardlink_groups": len(hardlink_groups),
        "hardlink_files": sum(g["count"] for g in hardlink_groups),
        "saved_bytes": saved_bytes,
        "cross_dir_groups": cross_dir_groups,
        "cross_dir_saved_bytes": cross_dir_saved_bytes,
        "symlink_count": len(symlinks),
        "broken_symlinks": sum(1 for s in symlinks if s.get("broken")),
        "outside_base_symlinks": sum(1 for s in symlinks if s.get("outside_base")),
        "errors": errors[:20],  # cap error list
    }
