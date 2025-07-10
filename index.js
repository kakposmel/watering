
const express = require('express');
const path = require('path');
const MoistureSensor = require('./src/moisture');
const PumpController = require('./src/pump');
const ScheduleController = require('./src/scheduleController');
const TelegramBotController = require('./src/telegram');
const Storage = require('./src/storage');
const config = require('./src/config');
const logger = require('./src/logger');

const app = express();

// Инициализация компонентов
const storage = new Storage();
const moistureSensor = new MoistureSensor(); // Keep for potential future use
const pumpController = new PumpController();
const telegramBot = new TelegramBotController(moistureSensor, pumpController);
const scheduleController = new ScheduleController(pumpController, telegramBot);

// Связываем компоненты с хранилищем
moistureSensor.setStorage(storage);
pumpController.setStorage(storage);
scheduleController.setStorage(storage);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/status', async (req, res) => {
  try {
    const pumps = pumpController.getPumpStates();
    const settings = await storage.loadSettings();
    const scheduleInfo = await scheduleController.getAllScheduleInfo();
    
    // Create zone status including schedule information
    const zones = [];
    for (let i = 0; i < config.relays.length; i++) {
      const zoneSettings = settings?.zones[i];
      const scheduleData = scheduleInfo[i];
      
      zones.push({
        index: i,
        name: zoneSettings?.name || `Зона ${i + 1}`,
        enabled: zoneSettings?.enabled || false,
        scheduleEnabled: zoneSettings?.scheduleEnabled || false,
        schedule: zoneSettings?.schedule || '',
        waterDuration: zoneSettings?.waterDuration || 15,
        isWatering: pumps.states[i] || false,
        nextWatering: scheduleData?.nextWatering,
        lastWatering: pumps.lastWatering[i] || 0
      });
    }
    
    res.json({
      zones,
      pumps,
      settings,
      scheduleInfo,
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

app.post('/api/rename-zone/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  const { name } = req.body;
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Имя зоны не может быть пустым' });
  }
  
  if (name.length > 50) {
    return res.status(400).json({ error: 'Имя зоны не может быть длиннее 50 символов' });
  }
  
  try {
    const success = await storage.updateZoneName(zone, name.trim());
    
    if (success) {
      // Уведомление в Telegram о переименовании зоны
      if (telegramBot.bot) {
        telegramBot.sendSystemNotification(
          `Зона ${zone + 1} переименована в "${name.trim()}"`
        );
      }
      
      res.json({ 
        success: true, 
        name: name.trim(),
        message: `Зона ${zone + 1} переименована в "${name.trim()}"`
      });
    } else {
      res.status(400).json({ error: 'Не удалось переименовать зону' });
    }
  } catch (error) {
    logger.error(`Ошибка переименования зоны ${zone + 1}:`, error);
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

// New API endpoints for schedule management
app.post('/api/schedule/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  const { schedule, duration, enabled } = req.body;
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const success = await scheduleController.updateZoneSchedule(zone, schedule, duration, enabled);
    
    if (success) {
      // Notify Telegram about schedule change
      if (telegramBot.bot) {
        const settings = await storage.loadSettings();
        const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
        telegramBot.sendSystemNotification(
          `Расписание "${zoneName}" обновлено: ${schedule}, ${duration}с`
        );
      }
      
      res.json({ 
        success: true, 
        message: `Расписание зоны ${zone + 1} обновлено` 
      });
    } else {
      res.status(400).json({ error: 'Не удалось обновить расписание' });
    }
  } catch (error) {
    logger.error(`Ошибка обновления расписания зоны ${zone + 1}:`, error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/toggle-schedule/:zone', async (req, res) => {
  const zone = parseInt(req.params.zone);
  
  if (zone < 0 || zone >= config.relays.length) {
    return res.status(400).json({ error: 'Неверный номер зоны' });
  }
  
  try {
    const settings = await storage.loadSettings();
    const zoneSettings = settings.zones[zone];
    const newScheduleEnabled = !zoneSettings.scheduleEnabled;
    
    const success = await scheduleController.updateZoneSchedule(
      zone, 
      zoneSettings.schedule, 
      zoneSettings.waterDuration, 
      newScheduleEnabled
    );
    
    if (success) {
      const zoneName = zoneSettings?.name || `Зона ${zone + 1}`;
      
      // Notify Telegram
      if (telegramBot.bot) {
        telegramBot.sendSystemNotification(
          `Расписание "${zoneName}" ${newScheduleEnabled ? 'включено' : 'отключено'}`
        );
      }
      
      res.json({ 
        success: true, 
        enabled: newScheduleEnabled,
        message: `Расписание зоны ${zone + 1} ${newScheduleEnabled ? 'включено' : 'отключено'}`
      });
    } else {
      res.status(400).json({ error: 'Не удалось переключить расписание' });
    }
  } catch (error) {
    logger.error(`Ошибка переключения расписания зоны ${zone + 1}:`, error);
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
  await scheduleController.cleanup();
  await pumpController.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Получен сигнал SIGTERM, завершение работы...');
  await scheduleController.cleanup();
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
    
    // Инициализация контроллера насосов
    const pumpInit = await pumpController.initialize();
    if (!pumpInit) {
      logger.error('Ошибка инициализации насосов');
    } else {
      logger.info('Контроллер насосов инициализирован');
    }
    
    // Инициализация Telegram bot
    const telegramInit = telegramBot.initialize();
    if (telegramInit) {
      logger.info('Telegram bot подключен');
      // Отправляем уведомление о запуске системы
      await telegramBot.sendSystemNotification('🌿 Система автополива запущена с расписанием');
    } else {
      logger.warn('Telegram bot не настроен - продолжаем без него');
    }
    
    // Инициализация контроллера расписания
    const scheduleInit = await scheduleController.initialize();
    if (scheduleInit) {
      logger.info('Контроллер расписания инициализирован');
    } else {
      logger.error('Ошибка инициализации контроллера расписания');
    }
    
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
