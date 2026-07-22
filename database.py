"""SQLite storage for Sync Music accounts, friendships, sessions and profile data."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any


def _resolve_db_path() -> Path:
    explicit_path = os.getenv("DATABASE_PATH", "").strip()
    if explicit_path:
        return Path(explicit_path).expanduser()

    volume_path = os.getenv("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if volume_path:
        return Path(volume_path) / "app.db"

    return Path(__file__).parent / "app.db"


DB_PATH = _resolve_db_path()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 15000")
    return connection


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    with get_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE COLLATE NOCASE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS friend_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_user TEXT COLLATE NOCASE NOT NULL,
                to_user TEXT COLLATE NOCASE NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(from_user, to_user)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT COLLATE NOCASE NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_username
            ON sessions(username);
            """
        )
        _ensure_column(connection, "users", "google_name", "TEXT")
        _ensure_column(connection, "users", "google_avatar", "TEXT")
        _ensure_column(connection, "users", "google_email", "TEXT")


def create_session(token: str, username: str) -> None:
    with get_db() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO sessions (token, username) VALUES (?, ?)",
            (token, username),
        )


def get_session_username(token: str) -> str | None:
    if not token:
        return None
    with get_db() as connection:
        row = connection.execute(
            "SELECT username FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
    return str(row["username"]) if row else None


def delete_session(token: str) -> None:
    if not token:
        return
    with get_db() as connection:
        connection.execute("DELETE FROM sessions WHERE token = ?", (token,))


def user_exists(username: str) -> bool:
    with get_db() as connection:
        return connection.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone() is not None


def create_user(username: str, password_hash: str) -> None:
    with get_db() as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash),
        )


def get_user(username: str) -> sqlite3.Row | None:
    with get_db() as connection:
        return connection.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()


def update_google_profile(
    username: str,
    *,
    display_name: str = "",
    avatar_url: str = "",
    email: str = "",
) -> None:
    with get_db() as connection:
        connection.execute(
            """
            UPDATE users
            SET google_name = ?, google_avatar = ?, google_email = ?
            WHERE username = ?
            """,
            (display_name[:120], avatar_url[:1000], email[:254], username),
        )


def clear_google_profile(username: str) -> None:
    update_google_profile(username, display_name="", avatar_url="", email="")


def get_public_profile(username: str) -> dict[str, Any]:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT username, google_name, google_avatar
            FROM users WHERE username = ?
            """,
            (username,),
        ).fetchone()
    if not row:
        return {"username": username, "displayName": username, "avatar": ""}
    return {
        "username": str(row["username"]),
        "displayName": str(row["google_name"] or row["username"]),
        "avatar": str(row["google_avatar"] or ""),
    }


def get_public_profiles(usernames: list[str]) -> dict[str, dict[str, Any]]:
    clean = sorted(
        {str(name).strip() for name in usernames if str(name).strip()},
        key=str.lower,
    )

    if not clean:
        return {}

    placeholders = ",".join("?" for _ in clean)

    with get_db() as connection:
        rows = connection.execute(
            f"""
            SELECT username, google_name, google_avatar
            FROM users
            WHERE username COLLATE NOCASE IN ({placeholders})
            """,
            clean,
        ).fetchall()

    profiles_by_username = {
        str(row["username"]).lower(): {
            "username": str(row["username"]),
            "displayName": str(row["google_name"] or row["username"]),
            "avatar": str(row["google_avatar"] or ""),
        }
        for row in rows
    }

    return {
        name: profiles_by_username.get(
            name.lower(),
            {
                "username": name,
                "displayName": name,
                "avatar": "",
            },
        )
        for name in clean
    }


def add_friend_request(from_user: str, to_user: str) -> str:
    with get_db() as connection:
        reverse = connection.execute(
            """
            SELECT status FROM friend_requests
            WHERE from_user = ? AND to_user = ?
            """,
            (to_user, from_user),
        ).fetchone()
        if reverse and reverse["status"] == "accepted":
            return "already_friends"
        if reverse and reverse["status"] == "pending":
            connection.execute(
                """
                UPDATE friend_requests SET status = 'accepted'
                WHERE from_user = ? AND to_user = ?
                """,
                (to_user, from_user),
            )
            return "accepted"

        existing = connection.execute(
            """
            SELECT status FROM friend_requests
            WHERE from_user = ? AND to_user = ?
            """,
            (from_user, to_user),
        ).fetchone()
        if existing:
            return "already_friends" if existing["status"] == "accepted" else "pending"

        connection.execute(
            """
            INSERT INTO friend_requests (from_user, to_user, status)
            VALUES (?, ?, 'pending')
            """,
            (from_user, to_user),
        )
        return "pending"


def accept_friend_request(from_user: str, to_user: str) -> bool:
    with get_db() as connection:
        cursor = connection.execute(
            """
            UPDATE friend_requests SET status = 'accepted'
            WHERE from_user = ? AND to_user = ? AND status = 'pending'
            """,
            (from_user, to_user),
        )
        return cursor.rowcount > 0


def get_pending_requests(to_user: str) -> list[str]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT from_user FROM friend_requests
            WHERE to_user = ? AND status = 'pending'
            ORDER BY id DESC
            """,
            (to_user,),
        ).fetchall()
    return [str(row["from_user"]) for row in rows]


def get_friends(username: str) -> list[str]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT from_user, to_user FROM friend_requests
            WHERE status = 'accepted' AND (from_user = ? OR to_user = ?)
            ORDER BY id DESC
            """,
            (username, username),
        ).fetchall()

    friends = {
        str(row["to_user"])
        if str(row["from_user"]).lower() == username.lower()
        else str(row["from_user"])
        for row in rows
    }
    return sorted(friends, key=str.lower)
