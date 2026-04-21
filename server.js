const express = require('express');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Разрешаем запросы с любого устройства
app.use(cors());
app.use(express.json());

// ---- Работа с данными ----

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Ошибка чтения данных:', e);
  }
  return { users: [], runs: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- Проверка работы сервера ----

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    time: new Date().toISOString(),
    message: 'Сервер Встреча работает!'
  });
});

// ---- Вход (без пароля, просто имя и город) ----

app.post('/api/login', (req, res) => {
  const { username, city } = req.body;

  if (!username || !city) {
    return res.status(400).json({ error: 'Введите имя и город' });
  }

  const data = loadData();

  let user = data.users.find(
    u => u.username === username && u.city === city
  );

  if (!user) {
    user = {
      id: uuidv4(),
      username: username.trim(),
      city: city.trim()
    };
    data.users.push(user);
    saveData(data);
  }

  res.json({ user });
});

// ---- Создать пробежку ----

app.post('/api/runs', (req, res) => {
  const {
    title,
    description,
    city,
    location_name,
    latitude,
    longitude,
    scheduled_at,
    creator
  } = req.body;

  if (!title || !city || !latitude || !longitude || !scheduled_at || !creator) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }

  const data = loadData();

  const run = {
    id: uuidv4(),
    title: title.trim(),
    description: (description || '').trim(),
    city: city.trim(),
    location_name: (location_name || '').trim(),
    latitude: Number(latitude),
    longitude: Number(longitude),
    scheduled_at,
    creator: {
      id: creator.id,
      username: creator.username
    },
    participants: [creator.id],
    created_at: new Date().toISOString()
  };

  data.runs.push(run);
  saveData(data);

  console.log(`Создана пробежка: ${run.title} в ${run.city}`);
  res.status(201).json(run);
});

// =====================================================
// ⚠️ ЭТИ МАРШРУТЫ ДОЛЖНЫ БЫТЬ ДО /api/runs/:city !!!
// =====================================================

// ---- Получить ВСЕ пробежки (из всех городов) ----

app.get('/api/runs/all', (req, res) => {
  const data = loadData();
  res.json(data.runs);
});

// ---- Поиск пробежек рядом (по координатам и радиусу в км) ----

app.get('/api/runs/nearby', (req, res) => {
  const { lat, lng, radius } = req.query;
  const data = loadData();

  if (!lat || !lng) {
    return res.json([]);
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxDistance = parseFloat(radius) || 100;

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const runsWithDistance = data.runs.map((run) => ({
    ...run,
    distance_km: Math.round(getDistance(userLat, userLng, run.latitude, run.longitude) * 10) / 10,
  }));

  const filtered = runsWithDistance
    .filter((r) => r.distance_km <= maxDistance)
    .sort((a, b) => a.distance_km - b.distance_km);

  res.json(filtered);
});

// =====================================================
// ⚠️ МАРШРУТ С :city — ТОЛЬКО ПОСЛЕ all И nearby
// =====================================================

// ---- Получить пробежки в конкретном городе ----

app.get('/api/runs/:city', (req, res) => {
  const data = loadData();
  const city = decodeURIComponent(req.params.city);
  const cityRuns = data.runs
    .filter(r => r.city === city)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  res.json(cityRuns);
});

// ---- Получить одну пробежку по ID ----

app.get('/api/run/:id', (req, res) => {
  const data = loadData();
  const run = data.runs.find(r => r.id === req.params.id);

  if (!run) {
    return res.status(404).json({ error: 'Пробежка не найдена' });
  }

  const participantsInfo = run.participants.map(pid => {
    const user = data.users.find(u => u.id === pid);
    return user || { id: pid, username: 'Участник', city: '' };
  });

  res.json({
    ...run,
    participants_info: participantsInfo
  });
});

// ---- Присоединиться к пробежке ----

app.post('/api/runs/:id/join', (req, res) => {
  const { userId } = req.body;
  const data = loadData();
  const run = data.runs.find(r => r.id === req.params.id);

  if (!run) {
    return res.status(404).json({ error: 'Пробежка не найдена' });
  }

  if (run.participants.includes(userId)) {
    return res.status(400).json({ error: 'Вы уже участвуете' });
  }

  run.participants.push(userId);
  saveData(data);

  console.log(`Пользователь ${userId} присоединился к ${run.title}`);
  res.json({ message: 'Вы присоединились!', participants: run.participants });
});

// ---- Покинуть пробежку ----

app.post('/api/runs/:id/leave', (req, res) => {
  const { userId } = req.body;
  const data = loadData();
  const run = data.runs.find(r => r.id === req.params.id);

  if (!run) {
    return res.status(404).json({ error: 'Пробежка не найдена' });
  }

  run.participants = run.participants.filter(p => p !== userId);
  saveData(data);

  res.json({ message: 'Вы покинули пробежку' });
});

// ---- Удалить пробежку (только создатель) ----

app.delete('/api/runs/:id', (req, res) => {
  const { userId } = req.body;
  const data = loadData();

  const runIndex = data.runs.findIndex(r => r.id === req.params.id);

  if (runIndex === -1) {
    return res.status(404).json({ error: 'Пробежка не найдена' });
  }

  if (data.runs[runIndex].creator.id !== userId) {
    return res.status(403).json({ error: 'Только создатель может удалить' });
  }

  const deleted = data.runs.splice(runIndex, 1);
  saveData(data);

  console.log(`Удалена пробежка: ${deleted[0].title}`);
  res.json({ message: 'Пробежка удалена' });
});

// ---- Редактировать пробежку (только создатель) ----

app.put('/api/runs/:id', (req, res) => {
  const data = loadData();
  const run = data.runs.find(r => r.id === req.params.id);

  if (!run) {
    return res.status(404).json({ error: 'Пробежка не найдена' });
  }

  const {
    title,
    description,
    location_name,
    latitude,
    longitude,
    scheduled_at
  } = req.body;

  if (title) run.title = title.trim();
  if (description !== undefined) run.description = description.trim();
  if (location_name) run.location_name = location_name.trim();
  if (latitude) run.latitude = Number(latitude);
  if (longitude) run.longitude = Number(longitude);
  if (scheduled_at) run.scheduled_at = scheduled_at;

  saveData(data);

  console.log(`Обновлена пробежка: ${run.title}`);
  res.json(run);
});

// ---- Запуск ----

app.post('/api/auth/send-code', async (req, res) => {
  const { email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email или телефон обязательны' });
  }

  const target = email || phone;
  const code = Math.floor(1000 + Math.random() * 9000).toString();

  verificationCodes.set(target, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0
  });

  // Если есть email — отправляем письмо через Resend
  if (email) {
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Код подтверждения Встреча',
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 30px; background: #fff; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);"><h2 style="color: #FF6B6B;">🏃‍♂️ Встреча</h2><p>Твой код подтверждения:</p><div style="background: #FFF3F3; border: 2px dashed #FF6B6B; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;"><span style="font-size: 36px; font-weight: bold; color: #FF6B6B; letter-spacing: 8px;">${code}</span></div><p style="color: #666; font-size: 14px;">Код действителен 10 минут.</p></div>`
      });
      console.log('✅ Email sent to', email);
      return res.json({ success: true, message: 'Код отправлен на почту' });
    } catch (error) {
      console.error('❌ Email error:', error);
      return res.status(500).json({ error: 'Ошибка отправки письма' });
    }
  }

  // Если только телефон — оставляем в консоль для теста
  console.log('SMS code for', phone, ':', code);
  res.json({ success: true, message: 'Код отправлен (тестовый режим SMS)' });
});


// Проверка кода подтверждения
app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email и код обязательны' });
  }

  const stored = verificationCodes.get(email);

  if (!stored) {
    return res.status(400).json({ error: 'Код не найден или истек' });
  }

  if (Date.now() > stored.expires) {
    verificationCodes.delete(email);
    return res.status(400).json({ error: 'Код истек' });
  }

  if (stored.code !== code) {
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts >= 5) {
      verificationCodes.delete(email);
      return res.status(400).json({ error: 'Слишком много попыток' });
    }
    return res.status(400).json({ error: 'Неверный код' });
  }

  // Код верный
  verificationCodes.delete(email);

  res.json({ 
    success: true, 
    message: 'Код подтвержден',
    token: 'verified-' + Date.now()
  });
});

// Получить сообщения чата пробежки
app.get('/api/runs/:id/chat', (req, res) => {
  const runId = req.params.id;
  const messages = chats.get(runId) || [];
  res.json({ messages });
});

// Отправить сообщение в чат
app.post('/api/runs/:id/chat', (req, res) => {
  const runId = req.params.id;
  const { userId, username, text } = req.body;

  if (!userId || !text) {
    return res.status(400).json({ error: 'userId и text обязательны' });
  }

  const message = {
    id: Date.now().toString(),
    userId,
    username: username || 'Аноним',
    text,
    createdAt: new Date().toISOString()
  };

  if (!chats.has(runId)) {
    chats.set(runId, []);
  }
  chats.get(runId).push(message);

  // Ограничиваем историю 100 сообщениями
  if (chats.get(runId).length > 100) {
    chats.get(runId).shift();
  }

  res.json({ success: true, message });
});

// Получить публичный профиль пользователя
app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  // Возвращаем только публичные поля
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    age: user.age,
    city: user.city,
    avatar: user.avatar,
    bio: user.bio,
    createdRuns: user.createdRuns || [],
    joinedRuns: user.joinedRuns || [],
    createdAt: user.createdAt
  });
});

// Обновить свой профиль
app.put('/api/users/me', (req, res) => {
  const { userId, age, city, bio, avatar } = req.body;

  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (age !== undefined) users[userIndex].age = age;
  if (city !== undefined) users[userIndex].city = city;
  if (bio !== undefined) users[userIndex].bio = bio;
  if (avatar !== undefined) users[userIndex].avatar = avatar;

  fs.writeFileSync('data.json', JSON.stringify({ users }, null, 2));

  res.json({ success: true, user: users[userIndex] });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('========================================');
  console.log('  🏃 Сервер "Встреча" запущен!');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log('========================================');
  console.log('');
});