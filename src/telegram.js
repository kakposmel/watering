const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const logger = require('./logger');

class TelegramBotController {
  constructor(moistureSensor, pumpController) {
    this.moistureSensor = moistureSensor;
    this.pumpController = pumpController;
    this.bot = null;
    this.chatId = null;
  }

  initialize() {
    if (!config.telegram.token) {
      logger.error('Telegram bot token не настроен');
      return false;
    }

    try {
      this.bot = new TelegramBot(config.telegram.token, { polling: true });
      this.chatId = config.telegram.chatId;
      
      this.setupCommands();
      logger.info('Telegram bot инициализирован');
      return true;
    } catch (error) {
      logger.error('Ошибка инициализации Telegram bot:', error);
      return false;
    }
  }

  setupCommands() {
    // Команда для показа влажности почвы
    this.bot.onText(/\/moisture/, async (msg) => {
      const chatId = msg.chat.id;

      try {
        const readings = await this.moistureSensor.readAllSensors();
        const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
        // Получаем актуальные данные о насосах, как в API
        const pumps = this.pumpController.getPumpStates();

        let message = '🌱 *Текущая влажность почвы:*\n\n';

        for (let index = 0; index < readings.length; index++) {
          const reading = readings[index];
          const zoneName = settings?.zones[index]?.name || `Зона ${index + 1}`;
          const zoneEnabled = settings?.zones[index]?.enabled !== false;
          const statusEmoji = this.getStatusEmoji(reading.status);
          const statusText = this.getStatusText(reading.status);

          if (!zoneEnabled) {
            message += `*${zoneName}:* ⚫ Отключена\n\n`;
            continue;
          }

          message += `*${zoneName}:* ${statusEmoji} ${statusText}\n`;
          if (reading.rawValue !== null) {
            message += `Уровень: ${reading.moisturePercent}% (${reading.rawValue} мВ)\n`;
          }
          const todayWaterings = pumps.dailyCount?.[index] ?? 0;
          const lastWatering = pumps.lastWatering?.[index]
            ? new Date(pumps.lastWatering[index]).toLocaleString('ru-RU')
            : 'Никогда';
          message += `Поливов сегодня: ${todayWaterings}\n`;
          message += `Последний полив: ${lastWatering}\n\n`;
        }

        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        logger.error('Ошибка получения данных влажности:', error);
        await this.bot.sendMessage(chatId, '❌ Ошибка получения данных датчиков');
      }
    });

    // Команда для запуска полива
    this.bot.onText(/\/water (\d+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const zone = parseInt(match[1]) - 1; // Пользователь вводит 1-4, мы используем 0-3
      
      if (zone < 0 || zone >= config.relays.length) {
        await this.bot.sendMessage(chatId, `❌ Неверный номер зоны. Доступны зоны 1-${config.relays.length}`);
        return;
      }
      
      try {
        const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
        const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
        
        const success = await this.pumpController.startWatering(zone);
        if (success) {
          await this.bot.sendMessage(chatId, `💧 Полив "${zoneName}" запущен`);
        } else {
          await this.bot.sendMessage(chatId, `❌ Не удалось запустить полив "${zoneName}"`);
        }
      } catch (error) {
        logger.error(`Ошибка запуска полива зоны ${zone + 1}:`, error);
        await this.bot.sendMessage(chatId, '❌ Ошибка при запуске полива');
      }
    });

    // Команда для включения/выключения зоны
    this.bot.onText(/\/toggle (\d+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const zone = parseInt(match[1]) - 1;
      
      if (zone < 0 || zone >= config.relays.length) {
        await this.bot.sendMessage(chatId, `❌ Неверный номер зоны. Доступны зоны 1-${config.relays.length}`);
        return;
      }
      
      try {
        if (!this.moistureSensor.storage) {
          await this.bot.sendMessage(chatId, '❌ Система хранения недоступна');
          return;
        }
        
        const settings = await this.moistureSensor.storage.loadSettings();
        const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
        settings.zones[zone].enabled = !settings.zones[zone].enabled;
        await this.moistureSensor.storage.saveSettings(settings);
        
        const status = settings.zones[zone].enabled ? 'включена' : 'отключена';
        await this.bot.sendMessage(chatId, `✅ "${zoneName}" ${status}`);
      } catch (error) {
        logger.error(`Ошибка переключения зоны ${zone + 1}:`, error);
        await this.bot.sendMessage(chatId, '❌ Ошибка при переключении зоны');
      }
    });

    // Команда помощи
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `🌿 *Команды системы автополива:*

/moisture - Показать текущую влажность почвы
/water <номер зоны> - Запустить полив зоны (1-${config.relays.length})
/toggle <номер зоны> - Включить/выключить зону (1-${config.relays.length})
/help - Показать это сообщение

*Примеры:*
/water 1 - полить зону 1
/toggle 2 - включить/выключить зону 2`;
      
      await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Обработка неизвестных команд
    this.bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('/') && !msg.text.match(/\/(moisture|water|toggle|help)/)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Неизвестная команда. Используйте /help для списка команд');
      }
    });
  }

  async sendWateringNotification(zone, action = 'started') {
    if (!this.bot || !this.chatId) return;

    try {
      const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
      const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
      const actionText = action === 'started' ? 'запущен' : 'завершен';
      const emoji = action === 'started' ? '💧' : '✅';
      
      const message = `${emoji} *Полив "${zoneName}" ${actionText}*\n\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки уведомления в Telegram:', error);
    }
  }

  async sendAutomaticWateringNotification(zone, moistureLevel) {
    if (!this.bot || !this.chatId) return;

    try {
      const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
      const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
      const message = `🤖 *Автоматический полив*\n\n"${zoneName}" полита автоматически\nУровень влажности: ${moistureLevel}\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки уведомления об автополиве:', error);
    }
  }

  getStatusEmoji(status) {
    const emojiMap = {
      'air': '🏜️',
      'dry': '🏜️',
      'moist': '🌱',
      'wet': '💧',
      'water': '💦',
      'disabled': '⚫',
      'error': '❌'
    };
    return emojiMap[status] || '❓';
  }

  getStatusText(status) {
    const statusMap = {
      'air': 'Воздух - подключите датчик',
      'dry': 'Сухо - требуется полив',
      'moist': 'Умеренная влажность',
      'wet': 'Хорошая влажность',
      'water': 'Переувлажнение',
      'disabled': 'Отключено',
      'error': 'Ошибка датчика'
    };
    return statusMap[status] || status;
  }

  async sendSystemNotification(message) {
    if (!this.bot || !this.chatId) return;

    try {
      await this.bot.sendMessage(this.chatId, `🔧 *Система:* ${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки системного уведомления:', error);
    }
  }

  async sendWarningNotification(message) {
    if (!this.bot || !this.chatId) return;

    try {
      await this.bot.sendMessage(this.chatId, `⚠️ *Предупреждение:* ${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки предупреждения:', error);
    }
  }

  async sendErrorNotification(title, details) {
    if (!this.bot || !this.chatId) return;

    try {
      const message = `❌ *Ошибка:* ${title}\n\nДетали: ${details}\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки уведомления об ошибке:', error);
    }
  }
}

module.exports = TelegramBotController;
