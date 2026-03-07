"""
FileScanner - Parses output from `tree --du -h` and analyzes directory structures.

Handles two tree formats:
1. `tree --du -h` output:  `[ 4.0K]  ├── dirname`
2. Plain tree output:      `├── filename.ext`

The key insight is that `tree` uses 4 characters per indent level:
  - "│   " (pipe + 3 spaces)
  - "├── " (branch + dash + dash + space)
  - "└── " (corner + dash + dash + space)
  - "    " (4 spaces for past-last-child levels)
"""

import os
import re


class FileScanner:
    VIDEO_EXTS = {
        '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv',
        '.m2ts', '.iso', '.rmvb', '.ts', '.m4v', '.mpg',
        '.mpeg', '.webm', '.vob', '.3gp',
    }
    METADATA_EXTS = {'.nfo', '.jpg', '.jpeg', '.png', '.txt', '.srt', '.ass'}
    ARCHIVE_EXTS = {'.zip', '.rar', '.7z', '.tar', '.gz'}
    GARBAGE_PATTERNS = [
        r'广告', r'promo', r'advert', r'readme\.txt$',
        r'\.DS_Store$', r'Thumbs\.db$', r'\.@__thumb',
        r'\.pad$', r'desktop\.ini$',
    ]
    # BT junk patterns
    BT_JUNK_PATTERNS = [
        r'\.torrent$', r'\.sfv$', r'\.nzb$',
        r'\.r\d+$',  # .r00, .r01, etc. (rar splits)
    ]

    def __init__(self, tree_file):
        self.tree_file = tree_file

    # -------- Size Parsing --------

    @staticmethod
    def parse_size(size_str):
        """Convert human-readable size like '4.0K' or '566G' to bytes."""
        size_str = size_str.strip('[] \t')
        if not size_str:
            return 0
        units = {'B': 1, 'K': 1024, 'M': 1024**2, 'G': 1024**3, 'T': 1024**4}
        unit = size_str[-1].upper()
        if unit in units:
            try:
                return int(float(size_str[:-1]) * units[unit])
            except ValueError:
                return 0
        try:
            return int(size_str)
        except ValueError:
            return 0

    # -------- Tree Parsing --------

    @staticmethod
    def _calc_depth(prefix):
        """
        Calculate directory depth from tree prefix characters.
        
        tree uses exactly 4 characters per level:
          │   ├── └──     (4 chars each)
        We strip the connector at each level and count how many 4-char
        groups exist.
        """
        # Remove the final connector (├── or └──) if present
        # What remains is the "indentation" part: sequences of "│   " or "    "
        cleaned = prefix.replace('├── ', '').replace('└── ', '')
        cleaned = cleaned.replace('├──', '').replace('└──', '')
        # Count remaining 4-char indent units
        indent_chars = cleaned.replace('│', ' ').replace('─', ' ')
        # Each level contributes ~4 characters of spacing
        if not indent_chars.strip() and not indent_chars:
            return 0
        return len(indent_chars) // 4

    def _parse_line(self, line):
        """
        Parse one line of tree output.
        
        Returns (depth, name, size_bytes) or None if line is unparsable.
        
        Formats handled:
          [4.0K]  ├── dirname
          [ 14K]  ├── .DS_Store
          ├── filename.ext           (no size)
          [ 566G]  /data              (root with size)
          /data                       (root without size)
        """
        stripped = line.rstrip('\r\n')
        if not stripped.strip():
            return None

        # Skip summary lines like "123 directories, 456 files"
        if re.match(r'^\s*\d+\s+director', stripped):
            return None

        # Try format WITH size prefix: [size]  prefix── name
        m = re.match(r'^\[([^\]]*)\]\s+(.*)', stripped)
        if m:
            size_str = m.group(1)
            rest = m.group(2)
        else:
            size_str = ''
            rest = stripped

        # Detect tree connectors
        connector_match = re.match(r'^(.*?)(├──|└──)\s*(.*)', rest)
        if connector_match:
            indent_part = connector_match.group(1)
            connector = connector_match.group(2)
            name = connector_match.group(3).strip()
            full_prefix = indent_part + connector + ' '
            depth = self._calc_depth(full_prefix) + 1  # +1 because connector = this level
        else:
            # Root line (no connector)
            name = rest.strip()
            depth = 0

        if not name:
            return None

        return (depth, name, self.parse_size(size_str))

    def scan(self):
        """Parse tree file and return analysis results."""
        if not os.path.exists(self.tree_file):
            return {"error": f"Tree file not found: {self.tree_file}"}

        with open(self.tree_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            return {"error": "Empty tree file"}

        # Build directory structure
        directories = {}
        path_stack = []  # [(depth, name), ...]

        for line in lines:
            parsed = self._parse_line(line)
            if parsed is None:
                continue

            depth, name, size_bytes = parsed

            # Update path stack: pop everything at depth >= current
            while path_stack and path_stack[-1][0] >= depth:
                path_stack.pop()

            path_stack.append((depth, name))
            full_path = '/'.join(item[1] for item in path_stack)
            parent_path = '/'.join(item[1] for item in path_stack[:-1]) if len(path_stack) > 1 else ''

            # Determine if file or directory
            ext = os.path.splitext(name)[1].lower()
            is_file = bool(ext)

            if is_file:
                # It's a file - add to parent
                if parent_path in directories:
                    directories[parent_path]["files"].append({
                        "name": name,
                        "size": size_bytes,
                        "ext": ext,
                        "path": full_path,
                    })
            else:
                # It's a directory
                directories[full_path] = {
                    "files": [],
                    "subdirs": [],
                    "size": size_bytes,
                }
                if parent_path in directories:
                    directories[parent_path]["subdirs"].append(name)

        return self.analyze(directories)

    # -------- Analysis --------

    def analyze(self, directories):
        """Analyze parsed directory structure and categorize issues."""
        analysis = {
            "summary": {
                "total_dirs": len(directories),
                "total_files": sum(len(d["files"]) for d in directories.values()),
                "total_size": sum(d["size"] for d in directories.values()),
            },
            "empty_dirs": [],
            "only_metadata": [],
            "no_videos": [],
            "has_archives": [],
            "garbage_files": [],
            "bt_junk_files": [],
        }

        for path, data in directories.items():
            files = data["files"]
            subdirs = data["subdirs"]

            # 1. Empty directories
            if not files and not subdirs:
                analysis["empty_dirs"].append({"path": path, "size": data["size"]})

            if not files:
                continue

            # Classify files
            has_video = False
            all_metadata = True
            has_archive = False
            dir_file_size = 0

            for f in files:
                dir_file_size += f["size"]
                ext = f["ext"]

                if ext in self.VIDEO_EXTS:
                    has_video = True
                if ext in self.ARCHIVE_EXTS:
                    has_archive = True
                if ext not in self.METADATA_EXTS:
                    all_metadata = False

                # Garbage check
                for pattern in self.GARBAGE_PATTERNS:
                    if re.search(pattern, f["name"], re.I):
                        analysis["garbage_files"].append({
                            "path": f["path"],
                            "size": f["size"],
                            "reason": pattern,
                        })
                        break

                # BT junk check
                for pattern in self.BT_JUNK_PATTERNS:
                    if re.search(pattern, f["name"], re.I):
                        analysis["bt_junk_files"].append({
                            "path": f["path"],
                            "size": f["size"],
                        })
                        break

            # 2. Directories with only metadata (no actual content)
            if all_metadata:
                analysis["only_metadata"].append({
                    "path": path,
                    "file_count": len(files),
                    "size": dir_file_size,
                })

            # 3. Directories without any video files
            if not has_video:
                analysis["no_videos"].append({
                    "path": path,
                    "file_count": len(files),
                    "size": dir_file_size,
                })

            # 4. Directories containing archives
            if has_archive:
                analysis["has_archives"].append({
                    "path": path,
                    "archives": [f["name"] for f in files if f["ext"] in self.ARCHIVE_EXTS],
                })

        return analysis
