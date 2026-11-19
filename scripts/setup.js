'use strict';
/* Первичная настройка: пароль входа и второй фактор (TOTP).
   Запуск на сервере:  npm run setup
   Повторный запуск меняет пароль и выдаёт новый секрет 2FA (старые сессии сбрасываются). */
const readline = require('readline');
const { db, setSetting } = require('../src/db');
const { hashPassword, newTotpSecret, verifyTotp } = require('../src/auth');

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  console.log('\n=== Настройка центра управления ===\n');
  let p1 = '';
  for (;;) {
    p1 = await ask('Новый пароль (минимум 12 символов): ', true);
    if (p1.length < 12) { console.log('Слишком короткий.'); continue; }
    const p2 = await ask('Повтори пароль: ', true);
    if (p1 !== p2) { console.log('Не совпадает, ещё раз.'); continue; }
    break;
  }
  const secret = newTotpSecret();
  const uri = `otpauth://totp/WAREE%20Hub:amir?secret=${secret}&issuer=WAREE%20Hub&algorithm=SHA1&digits=6&period=30`;
  console.log('\nДобавь ключ в Google Authenticator / Aegis / 2FAS («Ввести ключ вручную»):\n');
  console.log('  Название:  WAREE Hub');
  console.log('  Ключ:      ' + secret.replace(/(.{4})/g, '$1 ').trim());
  console.log('  Тип:       по времени\n');
  console.log('Или ссылка для приложения:\n  ' + uri + '\n');
  for (;;) {
    const code = (await ask('Введи 6 цифр из приложения, чтобы проверить: ')).trim();
    if (verifyTotp(secret, code)) break;
    console.log('Код не подошёл. Проверь время на телефоне и попробуй снова.');
  }
  setSetting('password', hashPassword(p1));
  setSetting('totp', secret);
  db.prepare('DELETE FROM sessions').run();
  console.log('\nГотово. Перезапусти сервис: sudo systemctl restart waree-hub\n');
  process.exit(0);
})();
