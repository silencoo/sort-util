"""
Batch Operations Engine - Preview and execute rename/delete operations.

All destructive operations require a two-step flow:
  1. Preview: returns a list of proposed changes without modifying the filesystem
  2. Execute: applies the changes after user confirmation
"""

import os
import re
import shutil


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
