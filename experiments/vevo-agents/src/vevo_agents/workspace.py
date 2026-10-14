"""Vevo-owned exact note/graph workspace backed by native SQLite.

The workspace is intentionally small: stable documents, revisions, links,
events and exact/FTS search. It does not import or imitate a third-party notes
application. SQLite is used through Python's standard library; the neural
memory remains a separate learned representation.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
import sqlite3


LINK_RE = re.compile(r"\[\[([A-Za-z0-9_.:/-]{1,96})\]\]")


@dataclass
class Document:
    note_id: str
    title: str
    text: str
    revision: int
    created_tick: int
    updated_tick: int

    def snapshot(self) -> dict:
        return {
            "note_id": self.note_id,
            "title": self.title,
            "text": self.text,
            "revision": self.revision,
            "created_tick": self.created_tick,
            "updated_tick": self.updated_tick,
        }


class NoteWorkspace:
    """Exact notes, links, editor revisions and search in a local SQLite DB."""

    def __init__(self, db_path: str = ":memory:", *, event_sink=None):
        self.db_path = db_path
        self.event_sink = event_sink
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.fts_enabled = True
        self.conn.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS documents (
                note_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                created_tick INTEGER NOT NULL CHECK (created_tick >= 0),
                updated_tick INTEGER NOT NULL CHECK (updated_tick >= created_tick)
            );
            CREATE TABLE IF NOT EXISTS links (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                PRIMARY KEY (source_id, target_id),
                FOREIGN KEY (source_id) REFERENCES documents(note_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS workspace_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                tick INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            """
        )
        self.fts_enabled = True
        try:
            self.conn.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(note_id UNINDEXED, title, text)"
            )
        except sqlite3.OperationalError:
            # SQLite builds without FTS5 still have deterministic exact/LIKE
            # search; the proof records this capability in its report.
            self.fts_enabled = False
        self._rebuild_fts()

    @staticmethod
    def _require_id(note_id: str) -> str:
        if not isinstance(note_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,96}", note_id):
            raise ValueError("invalid note ID")
        return note_id

    @staticmethod
    def _require_text(value: str, name: str) -> str:
        if not isinstance(value, str) or len(value) > 200_000:
            raise ValueError(f"invalid {name}")
        return value

    def close(self) -> None:
        self.conn.close()

    def _rebuild_fts(self) -> None:
        if not self.fts_enabled:
            return
        self.conn.execute("DELETE FROM documents_fts")
        self.conn.execute(
            "INSERT INTO documents_fts(note_id, title, text) SELECT note_id, title, text FROM documents"
        )

    def _record(self, event_type: str, tick: int, payload: dict) -> dict:
        event = {"type": event_type, "tick": tick, **payload}
        self.conn.execute(
            "INSERT INTO workspace_events(event_type, tick, payload) VALUES (?, ?, ?)",
            (event_type, tick, json.dumps(event, sort_keys=True, separators=(",", ":"))),
        )
        if self.event_sink is not None:
            self.event_sink(event_type, event)
        return event

    def _document(self, note_id: str) -> Document:
        row = self.conn.execute("SELECT * FROM documents WHERE note_id = ?", (note_id,)).fetchone()
        if row is None:
            raise KeyError(note_id)
        return Document(
            note_id=row["note_id"],
            title=row["title"],
            text=row["text"],
            revision=row["revision"],
            created_tick=row["created_tick"],
            updated_tick=row["updated_tick"],
        )

    def _refresh_links(self, source_id: str, text: str) -> None:
        self.conn.execute("DELETE FROM links WHERE source_id = ?", (source_id,))
        self.conn.executemany(
            "INSERT OR IGNORE INTO links(source_id, target_id) VALUES (?, ?)",
            [(source_id, target) for target in LINK_RE.findall(text)],
        )

    def create(self, note_id: str, title: str, text: str, tick: int) -> Document:
        note_id = self._require_id(note_id)
        title = self._require_text(title, "title").strip()
        text = self._require_text(text, "text")
        if not title or type(tick) is not int or tick < 0:
            raise ValueError("invalid note metadata")
        with self.conn:
            try:
                self.conn.execute(
                    "INSERT INTO documents(note_id, title, text, revision, created_tick, updated_tick) VALUES (?, ?, ?, 1, ?, ?)",
                    (note_id, title, text, tick, tick),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("note already exists") from exc
            self._refresh_links(note_id, text)
            if self.fts_enabled:
                self.conn.execute("INSERT INTO documents_fts(note_id, title, text) VALUES (?, ?, ?)", (note_id, title, text))
            self._record("document.created", tick, {"note_id": note_id, "revision": 1})
        return self._document(note_id)

    def edit(self, note_id: str, text: str, tick: int, *, expected_revision: int) -> Document:
        note_id = self._require_id(note_id)
        text = self._require_text(text, "text")
        document = self._document(note_id)
        if type(expected_revision) is not int or expected_revision != document.revision:
            raise ValueError("stale document revision")
        if type(tick) is not int or tick < document.updated_tick:
            raise ValueError("document ticks must be monotonic")
        new_revision = document.revision + 1
        with self.conn:
            self.conn.execute(
                "UPDATE documents SET text = ?, revision = ?, updated_tick = ? WHERE note_id = ?",
                (text, new_revision, tick, note_id),
            )
            self._refresh_links(note_id, text)
            if self.fts_enabled:
                self.conn.execute("DELETE FROM documents_fts WHERE note_id = ?", (note_id,))
                self.conn.execute(
                    "INSERT INTO documents_fts(note_id, title, text) VALUES (?, ?, ?)",
                    (note_id, document.title, text),
                )
            self._record("document.edited", tick, {"note_id": note_id, "revision": new_revision})
        return self._document(note_id)

    def add_link(self, source_id: str, target_id: str, tick: int) -> None:
        source_id = self._require_id(source_id)
        target_id = self._require_id(target_id)
        self._document(source_id)
        if type(tick) is not int or tick < 0:
            raise ValueError("invalid link tick")
        with self.conn:
            self.conn.execute("INSERT OR IGNORE INTO links(source_id, target_id) VALUES (?, ?)", (source_id, target_id))
            self._record("document.linked", tick, {"source": source_id, "target": target_id})

    def search(self, query: str, *, exact: bool = False) -> list[dict]:
        if not isinstance(query, str) or not query:
            raise ValueError("search query must be non-empty")
        if exact or not self.fts_enabled:
            rows = self.conn.execute(
                "SELECT note_id, title, revision FROM documents WHERE instr(title || char(10) || text, ?) > 0 ORDER BY note_id",
                (query,),
            ).fetchall()
        else:
            tokens = re.findall(r"[A-Za-z0-9_:/.-]+", query)
            if not tokens:
                return []
            match = " AND ".join('"' + token.replace('"', '""') + '"' for token in tokens)
            rows = self.conn.execute(
                "SELECT d.note_id, d.title, d.revision FROM documents d JOIN documents_fts f ON f.note_id = d.note_id WHERE documents_fts MATCH ? ORDER BY d.note_id",
                (match,),
            ).fetchall()
        return [{"note_id": row["note_id"], "title": row["title"], "revision": row["revision"]} for row in rows]

    def outgoing(self, note_id: str) -> list[str]:
        self._require_id(note_id)
        return [row[0] for row in self.conn.execute("SELECT target_id FROM links WHERE source_id = ? ORDER BY target_id", (note_id,))]

    def backlinks(self, note_id: str) -> list[str]:
        self._require_id(note_id)
        return [row[0] for row in self.conn.execute("SELECT source_id FROM links WHERE target_id = ? ORDER BY source_id", (note_id,))]

    @property
    def events(self) -> list[dict]:
        rows = self.conn.execute("SELECT payload FROM workspace_events ORDER BY event_id").fetchall()
        return [json.loads(row[0]) for row in rows]

    def snapshot(self) -> dict:
        documents = {
            row["note_id"]: {
                "note_id": row["note_id"],
                "title": row["title"],
                "text": row["text"],
                "revision": row["revision"],
                "created_tick": row["created_tick"],
                "updated_tick": row["updated_tick"],
            }
            for row in self.conn.execute("SELECT * FROM documents ORDER BY note_id")
        }
        links = [list(row) for row in self.conn.execute("SELECT source_id, target_id FROM links ORDER BY source_id, target_id")]
        return {
            "schema": "vevo.note-workspace.v2",
            "backend": "sqlite3",
            "fts5": self.fts_enabled,
            "documents": documents,
            "links": links,
            "events": self.events[-512:],
        }

    @classmethod
    def restore(cls, state: dict, *, event_sink=None, db_path: str = ":memory:") -> "NoteWorkspace":
        if state.get("schema") not in {"vevo.note-workspace.v1", "vevo.note-workspace.v2"}:
            raise ValueError("unsupported note workspace schema")
        workspace = cls(db_path, event_sink=event_sink)
        existing = {
            "documents": workspace.conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0],
            "links": workspace.conn.execute("SELECT COUNT(*) FROM links").fetchone()[0],
            "events": workspace.conn.execute("SELECT COUNT(*) FROM workspace_events").fetchone()[0],
        }
        if any(existing.values()):
            workspace.close()
            raise ValueError("workspace restore target must be empty")
        with workspace.conn:
            for note_id, payload in state.get("documents", {}).items():
                workspace.conn.execute(
                    "INSERT INTO documents(note_id, title, text, revision, created_tick, updated_tick) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        str(note_id),
                        str(payload["title"]),
                        str(payload["text"]),
                        int(payload["revision"]),
                        int(payload["created_tick"]),
                        int(payload["updated_tick"]),
                    ),
                )
            workspace.conn.executemany(
                "INSERT INTO links(source_id, target_id) VALUES (?, ?)",
                [tuple(link) for link in state.get("links", [])],
            )
            for event in state.get("events", [])[-512:]:
                workspace.conn.execute(
                    "INSERT INTO workspace_events(event_type, tick, payload) VALUES (?, ?, ?)",
                    (
                        event.get("type", "workspace.event"),
                        int(event.get("tick", 0)),
                        json.dumps(event, sort_keys=True, separators=(",", ":")),
                    ),
                )
            workspace._rebuild_fts()
        return workspace

    def projection(self) -> dict:
        rows = self.conn.execute("SELECT * FROM documents ORDER BY note_id").fetchall()
        return {
            "backend": "sqlite3",
            "fts5": self.fts_enabled,
            "notes": [
                {
                    "note_id": row["note_id"],
                    "title": row["title"],
                    "revision": row["revision"],
                    "outgoing": self.outgoing(row["note_id"]),
                    "backlinks": self.backlinks(row["note_id"]),
                }
                for row in rows
            ],
            "link_count": self.conn.execute("SELECT COUNT(*) FROM links").fetchone()[0],
            "latest_event": self.events[-1] if self.events else None,
        }

    def digest(self) -> str:
        encoded = json.dumps(self.snapshot(), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()
