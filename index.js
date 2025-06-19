
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
const pumpController = new PumpController();
const telegramBot = new TelegramBotController(moistureSensor, pumpController);
const scheduler = new AutoWateringScheduler(moistureSensor, pumpController, telegramBot, ledController);

// Связываем компоненты с хранилищем
moistureSensor.setStorage(storage);
pumpController.setStorage(storage);

// Связываем telegram bot с датчиками для уведомлений об ошибках
moistureSensor.setTelegramBot(telegramBot);

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
    if (config.led.enabled) {
      ledController.updateFromSensorReadings(sensors);
    }
    
    res.json({
      sensors,
      pumps,
      settings,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Ошибка получения статуса:', error);
    
    // Отправляем критическую ошибку в Telegram
    if (telegramBot.bot) {
      telegramBot.sendErrorNotification('Ошибка получения статуса системы', error.message);
    }
    
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
    
    // Уведомление в Telegram о переключении зоны
    if (telegramBot.bot) {
      telegramBot.sendSystemNotification(
        `Зона ${zone + 1} ${settings.zones[zone].enabled ? 'включена' : 'отключена'}`
      );
    }
    
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

app.post('/api/stop/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const success = await pumpController.stopWatering(zone);
    res.json({ 
      success, 
      message: success ? `Полив зоны ${zone + 1} остановлен` : 'Не удалось остановить полив'
    });
  } catch (error) {
    logger.error(`Ошибка остановки полива зоны ${zone + 1}:`, error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/stop-all', async (req, res) => {
  try {
    await pumpController.stopAllPumps();
    res.json({ success: true, message: 'Все насосы остановлены' });
  } catch (error) {
    logger.error('Ошибка остановки всех насосов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/test-all', async (req, res) => {
  try {
    for (let i = 0; i < config.relays.length; i++) {
      if (pumpController.relays[i]) {
        pumpController.relays[i].writeSync(0); // Включить
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды
        pumpController.relays[i].writeSync(1); // Выключить
      }
    }
    
    // Уведомление в Telegram о тестовом поливе
    if (telegramBot.bot) {
      telegramBot.sendSystemNotification('Тестовый полив всех зон завершен');
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
process.on('SIGINT', async () => {
  logger.info('Получен сигнал SIGINT, завершение работы...');
  if (config.led.enabled) {
    ledController.cleanup();
  }
  await pumpController.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Получен сигнал SIGTERM, завершение работы...');
  if (config.led.enabled) {
    ledController.cleanup();
  }
  await pumpController.cleanup();
  process.exit(0);
});

// Инициализация системы
async function initializeSystem() {
  try {
    logger.info('Инициализация системы автополива...');
    
    // Создание папки для логов
    const fs = require('fs');
    if (!fs.existsSync(path.join(__dirname, 'logs'))) {
      fs.mkdirSync(path.join(__dirname, 'logs'));
    }
    
    // Инициализация хранилища
    await storage.initialize();
    logger.info('Хранилище инициализировано');
    
    // Инициализация датчиков влажности
    const sensorInit = await moistureSensor.initialize();
    if (!sensorInit) {
      const errorMsg = 'Критическая ошибка: не удалось инициализировать датчики влажности';
      logger.error(errorMsg);
      
      // Отправляем критическую ошибку в Telegram перед выходом
      if (telegramBot.initialize()) {
        await telegramBot.sendErrorNotification('Критическая ошибка системы', errorMsg);
      }
      process.exit(1);
    }
    logger.info('Датчики влажности инициализированы');
    
    // Инициализация контроллера насосов
    const pumpInit = await pumpController.initialize();
    if (!pumpInit) {
      logger.error('Ошибка инициализации насосов');
    } else {
      logger.info('Контроллер насосов инициализирован');
    }
    
    // Инициализация LED индикатора (опционально)
    if (config.led.enabled) {
      const ledInit = ledController.initialize();
      if (ledInit) {
        logger.info('LED индикатор подключен');
      } else {
        logger.warn('LED индикатор не удалось инициализировать');
      }
    } else {
      logger.info('LED индикатор отключен в конфигурации');
    }
    
    // Инициализация Telegram bot
    const telegramInit = telegramBot.initialize();
    if (telegramInit) {
      logger.info('Telegram bot подключен');
      // Отправляем уведомление о запуске системы
      await telegramBot.sendSystemNotification('🌿 Система автополива запущена и готова к работе');
    } else {
      logger.warn('Telegram bot не настроен - продолжаем без него');
    }
    
    // Запуск планировщика
    scheduler.start();
    logger.info('Планировщик автополива запущен');
    
    // Запуск веб-сервера
    app.listen(config.server.port, '0.0.0.0', () => {
      logger.info(`🌿 Сервер автополива запущен на порту ${config.server.port}`);
      logger.info(`📱 Веб-интерфейс: http://localhost:${config.server.port}`);
    });
    
  } catch (error) {
    logger.error('Критическая ошибка запуска системы:', error);
    
    // Попытка отправить критическую ошибку в Telegram
    try {
      if (telegramBot.initialize()) {
        await telegramBot.sendErrorNotification('Критическая ошибка запуска', error.message);
      }
    } catch (telegramError) {
      logger.error('Не удалось отправить ошибку в Telegram:', telegramError);
    }
    
    process.exit(1);
  }
}

initializeSystem();
