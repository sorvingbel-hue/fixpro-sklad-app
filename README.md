# Форман

Помощник бригадира HVAC: обучение на смене, библиотека установок, правила Калифорнии, склад.
Один код на Expo для iPhone, Android и веба; данные команды — в общей базе Supabase.

```bash
npm install
cp .env.example .env      # вписать адрес и публичный ключ базы
npx expo start            # телефон: QR-код в Expo Go
npm run web               # веб в браузере
npm run web:export        # статичная веб-версия в dist/
npm run typecheck
npm run test:sync         # проверка синхронизации на настоящей базе (временная команда)
```

Устройство приложения и модель синхронизации — в [ARCHITECTURE.md](ARCHITECTURE.md).
