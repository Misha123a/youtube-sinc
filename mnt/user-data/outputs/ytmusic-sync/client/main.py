"""
Десктопный клиент — просто окно со встроенным браузером (QtWebEngine),
которое открывает веб-интерфейс, раздаваемый сервером (server/main.py).

Вся логика (авторизация, друзья, поиск, плеер, синхронизация) — на
сервере и во фронтенде (server/static/*), Python здесь почти ничего
не делает, кроме открытия окна и запоминания адреса сервера.

Установка:
    pip install PySide6

Запуск:
    python main.py

При первом запуске спросит адрес сервера (например, http://localhost:8000
для локального теста, или адрес твоего задеплоенного сервера для
использования с друзьями из других городов). Адрес запоминается
в config.json рядом со скриптом.
"""

import sys
import json
from pathlib import Path
from PySide6.QtWidgets import QApplication, QMainWindow, QInputDialog
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtCore import QUrl

CONFIG_PATH = Path(__file__).parent / "config.json"


def get_server_address() -> str:
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            return data["server_address"]
        except Exception:
            pass

    address, ok = QInputDialog.getText(
        None,
        "Адрес сервера",
        "Введи адрес сервера (например, http://localhost:8000):",
        text="http://localhost:8000",
    )
    if not ok or not address.strip():
        address = "http://localhost:8000"

    CONFIG_PATH.write_text(json.dumps({"server_address": address.strip()}))
    return address.strip()


class MainWindow(QMainWindow):
    def __init__(self, server_address: str):
        super().__init__()
        self.setWindowTitle("Sync Music")
        self.resize(1100, 750)

        self.view = QWebEngineView()
        self.view.load(QUrl(server_address))
        self.setCentralWidget(self.view)


def main():
    app = QApplication(sys.argv)
    server_address = get_server_address()
    window = MainWindow(server_address)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
