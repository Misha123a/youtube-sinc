"""Password hashing and in-memory Sync Music sessions."""
import secrets
import bcrypt
sessions: dict[str, str] = {}
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
def create_session(username: str) -> str:
    token = secrets.token_hex(16); sessions[token] = username; return token
def get_username(token: str) -> str | None:
    return sessions.get(token)
