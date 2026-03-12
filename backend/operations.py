"""
Batch Operations Engine - Preview and execute rename/delete operations.

All destructive operations require a two-step flow:
  1. Preview: returns a list of proposed changes without modifying the filesystem
  2. Execute: applies the changes after user confirmation
"""

import os
import re
import shutil
import time
import uuid


class BatchOps:
    """Handles batch file operations with safety preview."""

    @staticmethod
    def preview_rename(base_dir, pattern, replacement, file_filter=None):
        """
        Preview regex rename operations.

        Args:
            base_dir: Root directory to search in
            pattern: Regex pattern to match against filenames
            replacement: Replacement string (supports regex groups like \\1)
            file_filter: Optional - 'files', 'dirs', or None for both

        Returns:
            List of {old_path, new_path, old_name, new_name}
        """
        results = []
        try:
            regex = re.compile(pattern)
        except re.error as e:
            return {"error": f"Invalid regex: {e}"}

        for root, dirs, files in os.walk(base_dir):
            targets = []
            if file_filter != 'dirs':
                targets += [(f, 'file') for f in files]
            if file_filter != 'files':
                targets += [(d, 'dir') for d in dirs]

            for name, item_type in targets:
                if regex.search(name):
                    new_name = regex.sub(replacement, name)
                    if new_name != name:
                        results.append({
                            "old_name": name,
                            "new_name": new_name,
                            "old_path": os.path.join(root, name),
                            "new_path": os.path.join(root, new_name),
                            "type": item_type,
                        })
        return results

    @staticmethod
    def execute_rename(operations):
        """
        Execute rename operations from a preview list.

        Args:
            operations: List of {old_path, new_path} dicts

        Returns:
            {success: int, failed: int, errors: [...]}
        """
        success = 0
        failed = 0
        errors = []

        for op in operations:
            old_path = op.get('old_path')
            new_path = op.get('new_path')
            try:
                if os.path.exists(old_path):
                    os.rename(old_path, new_path)
                    success += 1
                else:
                    errors.append(f"Not found: {old_path}")
                    failed += 1
            except OSError as e:
                errors.append(f"{old_path}: {e}")
                failed += 1

        return {"success": success, "failed": failed, "errors": errors}

    @staticmethod
    def preview_delete(base_dir, pattern=None, paths=None):
        """
        Preview delete operations.

        Args:
            base_dir: Root directory to search in
            pattern: Regex pattern to match filenames (optional)
            paths: Explicit list of paths to delete (optional)

        Returns:
            List of {path, name, type, size}
        """
        results = []

        if paths:
            # Explicit path list mode
            for p in paths:
                if os.path.exists(p):
                    is_dir = os.path.isdir(p)
                    size = 0
                    if not is_dir:
                        size = os.path.getsize(p)
                    else:
                        for r, _, fs in os.walk(p):
                            for f in fs:
                                try:
                                    size += os.path.getsize(os.path.join(r, f))
                                except OSError:
                                    pass
                    results.append({
                        "path": p,
                        "name": os.path.basename(p),
                        "type": "dir" if is_dir else "file",
                        "size": size,
                    })
        elif pattern:
            # Regex pattern mode
            try:
                regex = re.compile(pattern)
            except re.error as e:
                return {"error": f"Invalid regex: {e}"}

            for root, dirs, files in os.walk(base_dir):
                for name in files + dirs:
                    if regex.search(name):
                        full_path = os.path.join(root, name)
                        is_dir = os.path.isdir(full_path)
                        size = 0
                        if not is_dir:
                            try:
                                size = os.path.getsize(full_path)
                            except OSError:
                                pass
                        results.append({
                            "path": full_path,
                            "name": name,
                            "type": "dir" if is_dir else "file",
                            "size": size,
                        })

        return results

    @staticmethod
    def execute_delete(operations):
        """
        Execute delete operations from a preview list.

        Args:
            operations: List of {path, type} dicts

        Returns:
            {success: int, failed: int, freed_bytes: int, errors: [...]}
        """
        success = 0
        failed = 0
        freed = 0
        errors = []

        for op in operations:
            path = op.get('path')
            item_type = op.get('type', 'file')
            try:
                if not os.path.exists(path):
                    errors.append(f"Not found: {path}")
                    failed += 1
                    continue

                if item_type == 'dir':
                    size = sum(
                        os.path.getsize(os.path.join(r, f))
                        for r, _, fs in os.walk(path) for f in fs
                    )
                    shutil.rmtree(path)
                else:
                    size = os.path.getsize(path)
                    os.remove(path)

                freed += size
                success += 1
            except OSError as e:
                errors.append(f"{path}: {e}")
                failed += 1

        return {"success": success, "failed": failed, "freed_bytes": freed, "errors": errors}

    @staticmethod
    def execute_quarantine(operations, quarantine_root, root_hint=None):
        """
        Move files/directories into a quarantine root.

        Args:
            operations: List of {path, type} dicts
            quarantine_root: Destination root directory
            root_hint: Optional root path to preserve relative structure

        Returns:
            {success: int, failed: int, moved_bytes: int, errors: [...], quarantine_root: str}
        """
        success = 0
        failed = 0
        moved = 0
        errors = []
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        batch_id = f'quarantine_{timestamp}_{uuid.uuid4().hex[:8]}'

        try:
            os.makedirs(quarantine_root, exist_ok=True)
        except OSError as e:
            return {"success": 0, "failed": len(operations), "moved_bytes": 0, "errors": [str(e)], "quarantine_root": quarantine_root}

        batch_dir = os.path.join(quarantine_root, batch_id)
        try:
            os.makedirs(batch_dir, exist_ok=True)
        except OSError as e:
            return {"success": 0, "failed": len(operations), "moved_bytes": 0, "errors": [str(e)], "quarantine_root": quarantine_root}

        root_hint_norm = None
        if root_hint:
            root_hint_norm = os.path.abspath(root_hint)

        for op in operations:
            path = op.get('path')
            item_type = op.get('type', 'file')
            if not path:
                errors.append("Missing path")
                failed += 1
                continue

            try:
                if not os.path.exists(path):
                    errors.append(f"Not found: {path}")
                    failed += 1
                    continue

                if item_type == 'dir':
                    size = sum(
                        os.path.getsize(os.path.join(r, f))
                        for r, _, fs in os.walk(path) for f in fs
                    )
                else:
                    size = os.path.getsize(path)

                dest = BatchOps._build_quarantine_path(batch_dir, path, root_hint_norm)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.move(path, dest)
                moved += size
                success += 1
            except OSError as e:
                errors.append(f"{path}: {e}")
                failed += 1

        return {
            "success": success,
            "failed": failed,
            "moved_bytes": moved,
            "errors": errors,
            "quarantine_root": batch_dir,
        }

    @staticmethod
    def _build_quarantine_path(batch_dir, source_path, root_hint=None):
        """
        Build a destination path inside batch_dir.
        Keeps relative structure when root_hint is provided.
        """
        src_abs = os.path.abspath(source_path)
        if root_hint:
            root_abs = os.path.abspath(root_hint)
            try:
                rel = os.path.relpath(src_abs, root_abs)
                if rel.startswith('..'):
                    rel = None
            except ValueError:
                rel = None
        else:
            rel = None

        if not rel:
            safe_name = src_abs.replace(':', '').lstrip('\\/').replace('\\', '/')
            rel = safe_name
        return os.path.join(batch_dir, rel)

    @staticmethod
    def list_quarantine(quarantine_root):
        """List quarantine batches and items."""
        batches = []
        if not os.path.isdir(quarantine_root):
            return {"batches": []}

        for entry in sorted(os.scandir(quarantine_root), key=lambda e: e.name, reverse=True):
            if not entry.is_dir():
                continue
            batch_path = entry.path
            items = []
            for root, dirs, files in os.walk(batch_path):
                for name in files:
                    full_path = os.path.join(root, name)
                    rel_path = os.path.relpath(full_path, batch_path)
                    try:
                        size = os.path.getsize(full_path)
                    except OSError:
                        size = 0
                    items.append({"path": rel_path, "type": "file", "size": size})
                for name in dirs:
                    full_path = os.path.join(root, name)
                    rel_path = os.path.relpath(full_path, batch_path)
                    items.append({"path": rel_path, "type": "dir", "size": 0})
            batches.append({
                "batch": entry.name,
                "path": batch_path,
                "items": items,
            })
        return {"batches": batches}

    @staticmethod
    def restore_quarantine(batch_path, entries, restore_root=None):
        """Restore selected entries from a quarantine batch."""
        success = 0
        failed = 0
        errors = []
        restored = 0

        if not os.path.isdir(batch_path):
            return {"success": 0, "failed": len(entries), "restored_bytes": 0, "errors": ["Batch not found"]}

        for entry in entries:
            rel_path = entry.get('path')
            if not rel_path:
                errors.append("Missing path")
                failed += 1
                continue
            source = os.path.join(batch_path, rel_path)
            if not os.path.exists(source):
                errors.append(f"Not found: {rel_path}")
                failed += 1
                continue

            dest = os.path.join(restore_root or os.path.dirname(batch_path), rel_path)
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                if os.path.isdir(source):
                    shutil.move(source, dest)
                else:
                    size = os.path.getsize(source)
                    shutil.move(source, dest)
                    restored += size
                success += 1
            except OSError as e:
                errors.append(f"{rel_path}: {e}")
                failed += 1

        return {"success": success, "failed": failed, "restored_bytes": restored, "errors": errors}
