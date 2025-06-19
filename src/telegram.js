
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
        let message = '🌱 *Текущая влажность почвы:*\n\n';
        
        readings.forEach((reading, index) => {
          const statusEmoji = this.getStatusEmoji(reading.status);
          const statusText = this.getStatusText(reading.status);
          
          message += `*Зона ${index + 1}:* ${statusEmoji} ${statusText}\n`;
          if (reading.rawValue !== null) {
            message += `Значение: ${reading.rawValue} мВ (${reading.moisturePercent}%)\n`;
          }
          message += '\n';
        });
        
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
        const success = await this.pumpController.startWatering(zone);
        if (success) {
          await this.bot.sendMessage(chatId, `💧 Полив зоны ${zone + 1} запущен`);
        } else {
          await this.bot.sendMessage(chatId, `❌ Не удалось запустить полив зоны ${zone + 1}`);
        }
      } catch (error) {
        logger.error(`Ошибка запуска полива зоны ${zone + 1}:`, error);
        await this.bot.sendMessage(chatId, '❌ Ошибка при запуске полива');
      }
    });

    // Команда помощи
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `🌿 *Команды системы автополива:*

/moisture - Показать текущую влажность почвы
/water <номер зоны> - Запустить полив зоны (1-${config.relays.length})
/status - Показать статус всех зон
/help - Показать это сообщение

*Примеры:*
/water 1 - полить зону 1
/water 2 - полить зону 2`;
      
      await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Команда статуса
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      
      try {
        const readings = await this.moistureSensor.readAllSensors();
        const pumpStates = this.pumpController.getPumpStates();
        
        let message = '📊 *Статус системы автополива:*\n\n';
        
        readings.forEach((reading, index) => {
          const statusEmoji = this.getStatusEmoji(reading.status);
          const statusText = this.getStatusText(reading.status);
          const isWatering = pumpStates.states[index] ? '🔄 Полив активен' : '⭕ Полив не активен';
          const dailyCount = pumpStates.dailyCount[index];
          
          message += `*Зона ${index + 1}:*\n`;
          message += `• Влажность: ${statusEmoji} ${statusText}\n`;
          if (reading.moisturePercent !== null) {
            message += `• Уровень: ${reading.moisturePercent}% (${reading.rawValue} мВ)\n`;
          }
          message += `• Статус: ${isWatering}\n`;
          message += `• Поливов сегодня: ${dailyCount}\n\n`;
        });
        
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        logger.error('Ошибка получения статуса:', error);
        await this.bot.sendMessage(chatId, '❌ Ошибка получения статуса системы');
      }
    });

    // Обработка неизвестных команд
    this.bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('/') && !msg.text.match(/\/(moisture|water|help|status)/)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Неизвестная команда. Используйте /help для списка команд');
      }
    });
  }

  async sendWateringNotification(zone, action = 'started') {
    if (!this.bot || !this.chatId) return;

    try {
      const actionText = action === 'started' ? 'запущен' : 'завершен';
      const emoji = action === 'started' ? '💧' : '✅';
      
      const message = `${emoji} *Полив зоны ${zone + 1} ${actionText}*\n\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Ошибка отправки уведомления в Telegram:', error);
    }
  }

  async sendAutomaticWateringNotification(zone, moistureLevel) {
    if (!this.bot || !this.chatId) return;

    try {
      const message = `🤖 *Автоматический полив*\n\nЗона ${zone + 1} полита автоматически\nУровень влажности: ${moistureLevel}\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
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
      'air': 'Воздух - срочно нужен полив',
      'dry': 'Сухо - нужен полив',
      'moist': 'Влажно - норма',
      'wet': 'Очень влажно',
      'water': 'Вода - переувлажнение',
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
