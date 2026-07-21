"""SQLite storage for Sync Music accounts and friendships."""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "app.db"


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


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
            """
        )


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
    return [row["from_user"] for row in rows]


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
        row["to_user"] if row["from_user"].lower() == username.lower() else row["from_user"]
        for row in rows
    }
    return sorted(friends, key=str.lower)
