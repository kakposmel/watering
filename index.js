const express = require('express');
const path = require('path');
const MoistureSensor = require('./src/moisture');
const PumpController = require('./src/pump');
const AutoWateringScheduler = require('./src/scheduler');
const TelegramBotController = require('./src/telegram');
const LEDController = require('./src/led');
const Storage = require('./src/storage');
const config = require('./src/config');
const logger = require('./src/logger');

const app = express();

// Инициализация компонентов
const storage = new Storage();
const moistureSensor = new MoistureSensor();
const ledController = new LEDController();
const telegramBot = new TelegramBotController(moistureSensor, null);
const pumpController = new PumpController(telegramBot);
const scheduler = new AutoWateringScheduler(moistureSensor, pumpController, telegramBot, ledController);

// Связываем компоненты с хранилищем
moistureSensor.setStorage(storage);
pumpController.setStorage(storage);

// Связываем Telegram bot с pump controller
telegramBot.pumpController = pumpController;

// Инициализация системы
async function initializeSystem() {
  try {
    await storage.initialize();
    
    if (!await moistureSensor.initialize()) {
      logger.error('Не удалось инициализировать датчики влажности');
    }
    
    if (!ledController.initialize()) {
      logger.error('Не удалось инициализировать LED контроллер');
    }
    
    if (!telegramBot.initialize()) {
      logger.warn('Telegram bot не инициализирован');
    }
    
    scheduler.start();
    logger.info('Система автополива запущена');
  } catch (error) {
    logger.error('Ошибка инициализации системы:', error);
  }
}

initializeSystem();Controller(telegramBot);
const scheduler = new AutoWateringScheduler(moistureSensor, pumpController, telegramBot, ledController);

// Связываем Telegram bot с pump controller
telegramBot.pumpController = pumpController;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/status', async (req, res) => {
  try {
    const sensors = await moistureSensor.readAllSensors();
    const pumps = pumpController.getPumpStates();
    const settings = await storage.loadSettings();
    
    // Обновляем LED на основе показаний датчиков
    ledController.updateFromSensorReadings(sensors);
    
    res.json({
      sensors,
      pumps,
      settings,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Ошибка получения статуса:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = await storage.loadHistory(limit);
    res.json(history);
  } catch (error) {
    logger.error('Ошибка получения истории:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/toggle-zone/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const settings = await storage.loadSettings();
    settings.zones[zone].enabled = !settings.zones[zone].enabled;
    await storage.saveSettings(settings);
    
    res.json({ 
      success: true, 
      enabled: settings.zones[zone].enabled,
      message: `Зона ${zone + 1} ${settings.zones[zone].enabled ? 'включена' : 'отключена'}`
    });
  } catch (error) {
    logger.error(`Ошибка переключения зоны ${zone + 1}:`, error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/water/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const success = await pumpController.startWatering(zone);
    res.json({ 
      success, 
      message: success ? `Полив зоны ${zone + 1} запущен` : 'Не удалось запустить полив'
    });
  } catch (error) {
    logger.error(`Ошибка полива зоны ${zone + 1}:`, error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/stop/:zone', (req, res) => {
  const zone = parseInt(req.params.zone);
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const success = pumpController.stopWatering(zone);
    res.json({ 
      success, 
      message: success ? `Полив зоны ${zone + 1} остановлен` : 'Не удалось остановить полив'
    });
  } catch (error) {
    logger.error(`Ошибка остановки полива зоны ${zone + 1}:`, error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/stop-all', (req, res) => {
  try {
    pumpController.stopAllPumps();
    res.json({ success: true, message: 'Все насосы остановлены' });
  } catch (error) {
    logger.error('Ошибка остановки всех насосов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/test-all', async (req, res) => {
  try {
    for (let i = 0; i < config.relays.length; i++) {
      pumpController.relays[i].writeSync(0); // Включить
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды
      pumpController.relays[i].writeSync(1); // Выключить
    }
    res.json({ success: true, message: 'Тестовый полив завершен' });
  } catch (error) {
    logger.error('Ошибка тестового полива:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Получен сигнал SIGINT, завершение работы...');
  ledController.cleanup();
  pumpController.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Получен сигнал SIGTERM, завершение работы...');
  ledController.cleanup();
  pumpController.cleanup();
  process.exit(0);
});

// Запуск сервера
async function startServer() {
  try {
    // Создание папки для логов
    const fs = require('fs');
    if (!fs.existsSync(path.join(__dirname, 'logs'))) {
      fs.mkdirSync(path.join(__dirname, 'logs'));
    }
    
    // Инициализация датчиков
    const sensorInit = await moistureSensor.initialize();
    if (!sensorInit) {
      logger.error('Не удалось инициализировать датчики');
      process.exit(1);
    }
    
    // Инициализация LED индикатора
    const ledInit = ledController.initialize();
    if (ledInit) {
      logger.info('LED индикатор подключен');
    } else {
      logger.warn('LED индикатор не настроен - продолжаем без него');
    }
    
    // Инициализация Telegram bot
    const telegramInit = telegramBot.initialize();
    if (telegramInit) {
      logger.info('Telegram bot подключен');
    } else {
      logger.warn('Telegram bot не настроен - продолжаем без него');
    }
    
    // Запуск планировщика
    scheduler.start();
    
    // Запуск веб-сервера
    app.listen(config.server.port, () => {
      logger.info(`🌿 Сервер автополива запущен на порту ${config.server.port}`);
      logger.info(`📱 Веб-интерфейс: http://localhost:${config.server.port}`);
    });
    
  } catch (error) {
    logger.error('Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

startServer();
