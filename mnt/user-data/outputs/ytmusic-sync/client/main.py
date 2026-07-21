"""Optional PySide6 wrapper for the Sync Music web application."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtWebEngineCore import QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QInputDialog, QMainWindow

APP_DIR = Path(__file__).parent
CONFIG_PATH = APP_DIR / "config.json"
PROFILE_PATH = APP_DIR / ".profile"


def get_server_address() -> str:
    if CONFIG_PATH.exists():
        try:
            value = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))["server_address"]
            if value:
                return str(value).rstrip("/")
        except (OSError, KeyError, ValueError, TypeError):
            pass

    address, accepted = QInputDialog.getText(
        None,
        "Sync Music",
        "Адрес сервера:",
        text="http://localhost:8000",
    )
    address = address.strip().rstrip("/") if accepted else "http://localhost:8000"
    if not address:
        address = "http://localhost:8000"
    CONFIG_PATH.write_text(
        json.dumps({"server_address": address}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return address


class PopupView(QWebEngineView):
    """Keep OAuth/new-window popups alive when Qt allows them."""

    def __init__(self, parent: QMainWindow | None = None) -> None:
        super().__init__(parent)
        self.popups: list[QMainWindow] = []

    def createWindow(self, _window_type):  # noqa: N802 - Qt method name
        window = QMainWindow(self)
        popup = PopupView(window)
        window.setCentralWidget(popup)
        window.resize(720, 760)
        window.setWindowTitle("Sync Music — вход")
        window.show()
        self.popups.append(window)
        window.destroyed.connect(lambda: self.popups.remove(window) if window in self.popups else None)
        return popup


class MainWindow(QMainWindow):
    def __init__(self, server_address: str) -> None:
        super().__init__()
        self.setWindowTitle("Sync Music")
        self.resize(1440, 900)
        self.setMinimumSize(980, 680)

        profile = QWebEngineProfile.defaultProfile()
        profile.setPersistentStoragePath(str(PROFILE_PATH / "storage"))
        profile.setCachePath(str(PROFILE_PATH / "cache"))
        profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)

        self.view = PopupView(self)
        self.view.load(QUrl(server_address))
        self.setCentralWidget(self.view)


def main() -> None:
    application = QApplication(sys.argv)
    application.setApplicationName("Sync Music")
    window = MainWindow(get_server_address())
    window.show()
    raise SystemExit(application.exec())


if __name__ == "__main__":
    main()
