# Sync Music 2.0

Современное веб-приложение для синхронного прослушивания музыки с друзьями через YouTube Music и официальный YouTube IFrame Player.

## Что уже сделано

- полностью новый тёмный анимированный интерфейс;
- адаптивная версия для компьютера и телефона;
- глобальный плеер, закреплённый снизу;
- видимый YouTube-плеер и собственные кнопки управления;
- живые подсказки YouTube Music при вводе;
- управление подсказками стрелками, `Enter` и `Esc`;
- быстрый вызов поиска через `Ctrl + K`;
- результаты с обложкой, артистом, альбомом и длительностью;
- очередь, следующий и предыдущий трек;
- перемотка, громкость и системные медиакнопки Windows;
- история недавно прослушанных треков и запросов;
- регистрация, вход, друзья и входящие заявки;
- онлайн-статусы друзей;
- создание комнаты и вход по шестизначному коду;
- приглашения друзьям в реальном времени;
- синхронизация трека, паузы, продолжения и перемотки;
- передача названия, артиста и обложки всем участникам;
- переподключение WebSocket при временной потере связи;
- опциональное подключение Google/YouTube-аккаунта через OAuth.

## Быстрый запуск на Windows

1. Установи Python 3.11 или новее.
2. Распакуй проект в отдельную папку.
3. Дважды нажми `run.bat`.
4. При первом запуске зависимости установятся автоматически.
5. Открой `http://localhost:8000`.

Запуск вручную:

```powershell
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Для Linux/macOS:

```bash
chmod +x run.sh
./run.sh
```

## Подключение Google/YouTube OAuth

Подключение выполняется отдельно в браузере каждого участника. Токен Google хранится только в `sessionStorage` конкретного браузера и не отправляется в базу Sync Music.

1. Создай проект в Google Cloud Console.
2. Включи **YouTube Data API v3**.
3. Настрой OAuth consent screen.
4. Создай OAuth Client ID с типом **Web application**.
5. Добавь разрешённые JavaScript origins:
   - `http://localhost:8000` для локальной проверки;
   - адрес продакшен-сайта, например `https://music.example.com`.
6. Скопируй `.env.example` в `.env`.
7. Вставь Web Client ID:

```env
GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

8. Перезапусти сервер.

Используется Google Identity Services Token Model и scope `youtube.readonly`.

Документация:

- Google OAuth Token Model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- YouTube OAuth: https://developers.google.com/youtube/v3/guides/authentication
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference

## Важное ограничение YouTube Premium

OAuth позволяет получить разрешённые данные профиля и YouTube, но **YouTube API не выдаёт приложению статус Premium и не включает отсутствие рекламы принудительно**.

Чтобы Premium мог примениться к воспроизведению, каждый участник должен отдельно войти на `music.youtube.com` в том же обычном браузере, где открыт Sync Music. Итоговое наличие рекламы полностью определяет YouTube. Приложение не блокирует и не скрывает рекламу.

Для подключения Google и использования личной YouTube-сессии рекомендуется Chrome, Edge, Firefox или другой обычный браузер. Google может ограничивать вход внутри встроенных браузеров, включая PySide6 WebEngine.

## Проверка с другом

1. Запусти сервер на публичном HTTPS-адресе или временно используй туннель.
2. Создай два аккаунта Sync Music.
3. Добавь второго пользователя в друзья и прими заявку.
4. Создай комнату.
5. Пригласи друга или отправь ему код.
6. Найди трек и запусти его.
7. Проверь паузу, продолжение и перемотку с обоих устройств.

## Деплой

Для постоянной работы нужен сервер, поддерживающий:

- Python;
- WebSocket;
- HTTPS;
- сохранение файла `app.db` между перезапусками.

Подойдут VPS, Railway, Render, Fly.io и похожие платформы. На бесплатных тарифах SQLite-файл иногда удаляется при новом деплое — для реального использования подключи persistent volume или позже перенеси данные в PostgreSQL.

Пример команды запуска:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Структура

```text
youtube-sinc/
├── main.py                 # FastAPI, API и WebSocket
├── database.py             # SQLite: аккаунты и друзья
├── auth.py                 # bcrypt и сессии
├── ws_manager.py           # комнаты и онлайн-соединения
├── ytmusic_search.py       # поиск и подсказки YouTube Music
├── requirements.txt
├── .env.example
├── run.bat
├── run.sh
├── static/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── desktop/
    ├── main.py
    └── requirements.txt
```

## База данных

`app.db` создаётся автоматически при первом запуске. Файл специально не лежит в архиве, чтобы не передавать тестовые аккаунты и хэши паролей.

Если заменяешь файлы в старой папке проекта, можешь оставить свой существующий `app.db`.

## Десктопная обёртка

```powershell
cd desktop
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

При первом запуске введи адрес сервера. Для Google OAuth и Premium-сессии всё равно лучше использовать обычный браузер.
