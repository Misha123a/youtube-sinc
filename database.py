"""
Простая работа с SQLite напрямую через стандартный модуль sqlite3
(без ORM — так проще понимать, что происходит).

База хранит только два типа данных:
- пользователей (users)
- заявки/статусы дружбы (friend_requests)

Комнаты для прослушивания НЕ хранятся в базе — они существуют только
пока сервер запущен (это временные "сессии", а не постоянные данные).
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "app.db"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted
            UNIQUE(from_user, to_user)
        );
        """
    )
    conn.commit()
    conn.close()


def user_exists(username: str) -> bool:
    conn = get_db()
    row = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row is not None


def create_user(username: str, password_hash: str) -> None:
    conn = get_db()
    conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )
    conn.commit()
    conn.close()


def get_user(username: str) -> sqlite3.Row | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row


def add_friend_request(from_user: str, to_user: str) -> None:
    conn = get_db()
    conn.execute(
        "INSERT OR IGNORE INTO friend_requests (from_user, to_user, status) VALUES (?, ?, 'pending')",
        (from_user, to_user),
    )
    conn.commit()
    conn.close()


def accept_friend_request(from_user: str, to_user: str) -> None:
    conn = get_db()
    conn.execute(
        "UPDATE friend_requests SET status = 'accepted' WHERE from_user = ? AND to_user = ?",
        (from_user, to_user),
    )
    conn.commit()
    conn.close()


def get_pending_requests(to_user: str) -> list[str]:
    conn = get_db()
    rows = conn.execute(
        "SELECT from_user FROM friend_requests WHERE to_user = ? AND status = 'pending'",
        (to_user,),
    ).fetchall()
    conn.close()
    return [r["from_user"] for r in rows]


def get_friends(username: str) -> list[str]:
    """Возвращает список друзей (заявка принята, неважно кто её отправил)."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT from_user, to_user FROM friend_requests
        WHERE status = 'accepted' AND (from_user = ? OR to_user = ?)
        """,
        (username, username),
    ).fetchall()
    conn.close()
    friends = set()
    for r in rows:
        other = r["to_user"] if r["from_user"] == username else r["from_user"]
        friends.add(other)
    return sorted(friends)
