# WAREE Hub — центр управления

Личная панель: сервисы, заметки, команды, статус серверов и сводка из Расходника и мандалы.
Node.js + Express + SQLite. Один пользователь, вход по паролю и коду 2FA.

## Установка на VPS

```bash
git clone git@github.com:acidofz/hub.git ~/hub && cd ~/hub
bash deploy/install.sh
cd /opt/waree-hub && HUB_DATA=/var/lib/waree-hub npm run setup   # пароль + 2FA
sudo systemctl restart waree-hub
```

DNS: запись `A` для `hub.waree.uz` → IP сервера. Caddy сам выпустит SSL.

Обновление: `cd ~/hub && git pull && bash deploy/update.sh`

## Синхронизация приложений

1. В центре: Настройки → «Создать ключ» → скопировать.
2. В Расходнике и мандале: Настройки → Синхронизация → адрес `https://hub.waree.uz` и ключ.

API для приложений (ключ в `Authorization: Bearer hub_…`):

| Метод | Путь | Что делает |
|---|---|---|
| `GET` | `/api/sync/ping` | проверка ключа |
| `PUT` | `/api/sync/rasxodnik` / `mandala` | сохранить данные `{ "data": {...} }` |
| `GET` | `/api/sync/rasxodnik` / `mandala` | забрать данные (новый телефон) |

Сервер хранит последнюю версию и до 30 прошлых копий (не чаще одной в 6 часов).

## Безопасность

- Пароль — scrypt, 2FA — TOTP, 5 неверных попыток → нарастающая блокировка.
- Сессия в cookie `HttpOnly; Secure; SameSite=Strict`, изменения требуют заголовок `X-Hub`.
- Ключи устройств хранятся только в виде хеша, отзываются в настройках.
- База в `/var/lib/waree-hub` (права 700), отдельно от базы WAREE.
- Бэкап базы: `sqlite3 /var/lib/waree-hub/hub.db ".backup hub-$(date +%F).db"`
