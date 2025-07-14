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
    // Команда для показа расписания поливов
    this.bot.onText(/\/schedule/, async (msg) => {
      const chatId = msg.chat.id;

      try {
        const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
        const pumps = this.pumpController.getPumpStates();

        let message = '📅 *Расписание поливов:*\n\n';

        for (let index = 0; index < config.relays.length; index++) {
          const zoneSettings = settings?.zones[index];
const zoneName = this.escapeMarkdown(zoneSettings?.name || `Зона ${index + 1}`);
          const enabled = zoneSettings?.enabled && zoneSettings?.scheduleEnabled;
          const schedule = zoneSettings?.schedule || 'не установлено';
          const duration = zoneSettings?.waterDuration || 15;
          
          const statusEmoji = enabled ? '✅' : '❌';
          
          message += `*${zoneName}:* ${statusEmoji}\n`;
          if (enabled) {
            message += `Расписание: ${schedule}\n`;
            message += `Длительность: ${duration} сек\n`;
            // Add next watering time if available
            // message += `Следующий полив: ${nextTime}\n`;
          } else {
            message += `Отключено\n`;
          }
          message += '\n';
        }

        // Try Markdown first, fallback to plain text if it fails
        try {
          await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (parseError) {
          // If Markdown parsing fails, send as plain text
          const plainMessage = message.replace(/\*/g, '').replace(/\\/g, '');
          await this.bot.sendMessage(chatId, plainMessage);
        }
      } catch (error) {
        logger.error('Ошибка получения данных расписания:', error);
        await this.bot.sendMessage(chatId, '❌ Ошибка получения данных расписания');
      }
    });

    // Команда для показа состояния системы
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;

      try {
        const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
        const pumps = this.pumpController.getPumpStates();

        let message = '🌱 *Состояние системы полива:*\n\n';

        for (let index = 0; index < config.relays.length; index++) {
          const zoneSettings = settings?.zones[index];
const zoneName = this.escapeMarkdown(settings?.zones[index]?.name || `Зона ${index + 1}`);
          const enabled = zoneSettings?.enabled;
          const scheduleEnabled = zoneSettings?.scheduleEnabled;
          const isActive = pumps.states?.[index] || false;
          
          let statusEmoji;
          let statusText;
          
          if (!enabled) {
            statusEmoji = '⚫';
            statusText = 'Отключена';
          } else if (isActive) {
            statusEmoji = '💧';
            statusText = 'Полив в процессе';
          } else if (scheduleEnabled) {
            statusEmoji = '✅';
            statusText = 'Готова к поливу';
          } else {
            statusEmoji = '⏸️';
            statusText = 'Расписание отключено';
          }

          message += `*${zoneName}:* ${statusEmoji} ${statusText}\n`;
          
          if (enabled && scheduleEnabled) {
            const schedule = zoneSettings?.schedule || 'не установлено';
            const duration = zoneSettings?.waterDuration || 15;
            message += `Расписание: ${schedule}\n`;
            message += `Длительность: ${duration} сек\n`;
          }
          
          const lastWatering = pumps.lastWatering?.[index]
            ? new Date(pumps.lastWatering[index]).toLocaleString('ru-RU')
            : 'Никогда';
          message += `Последний полив: ${lastWatering}\n\n`;
        }

        // Try Markdown first, fallback to plain text if it fails
        try {
          await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (parseError) {
          // If Markdown parsing fails, send as plain text
          const plainMessage = message.replace(/\*/g, '').replace(/\\/g, '');
          await this.bot.sendMessage(chatId, plainMessage);
        }
      } catch (error) {
        logger.error('Ошибка получения состояния системы:', error);
        await this.bot.sendMessage(chatId, '❌ Ошибка получения данных системы');
      }
    });

    // Команда для установки расписания
    this.bot.onText(/\/setschedule (\d+) ([\d\s\*,\/\-]+) (\d+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const zone = parseInt(match[1]) - 1; // Пользователь вводит 1-4, мы используем 0-3
      const schedule = match[2].trim();
      const duration = parseInt(match[3]);
      
      if (zone < 0 || zone >= config.relays.length) {
        await this.bot.sendMessage(chatId, `❌ Неверный номер зоны. Доступны зоны 1-${config.relays.length}`);
        return;
      }
      
      if (duration < 1 || duration > 300) {
        await this.bot.sendMessage(chatId, '❌ Длительность должна быть от 1 до 300 секунд');
        return;
      }
      
      try {
        // Validate cron expression
        const cron = require('node-cron');
        if (!cron.validate(schedule)) {
          await this.bot.sendMessage(chatId, '❌ Неверный формат расписания. Пример: "0 8 * * *" (каждый день в 8:00)');
          return;
        }
        
        if (!this.moistureSensor.storage) {
          await this.bot.sendMessage(chatId, '❌ Система хранения недоступна');
          return;
        }
        
        const settings = await this.moistureSensor.storage.loadSettings();
        const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
        
        // Update schedule settings
        settings.zones[zone].schedule = schedule;
        settings.zones[zone].waterDuration = duration;
        settings.zones[zone].scheduleEnabled = true;
        
        await this.moistureSensor.storage.saveSettings(settings);
        
await this.bot.sendMessage(chatId, `✅ Расписание для "${this.escapeMarkdown(zoneName)}" обновлено:\nРасписание: ${schedule}\nДлительность: ${duration} сек`);
        
        // Note: Schedule controller restart will be handled by the main app
      } catch (error) {
        logger.error(`Ошибка установки расписания для зоны ${zone + 1}:`, error);
        await this.bot.sendMessage(chatId, '❌ Ошибка при установке расписания');
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
await this.bot.sendMessage(chatId, `💧 Полив "${this.escapeMarkdown(zoneName)}" запущен`);
        } else {
await this.bot.sendMessage(chatId, `❌ Не удалось запустить полив "${this.escapeMarkdown(zoneName)}"`);
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

/status - Показать состояние системы
/schedule - Показать расписание поливов
/setschedule <номер> <расписание> <секунды> - Установить расписание
/water <номер зоны> - Запустить полив зоны (1-${config.relays.length})
/toggle <номер зоны> - Включить/выключить зону (1-${config.relays.length})
/help - Показать это сообщение

*Примеры:*
/setschedule 1 "0 8 * * *" 15 - полив зоны 1 каждый день в 8:00 на 15 сек
/water 1 - ручной полив зоны 1
/toggle 2 - включить/выключить зону 2

*Формат расписания (cron):*
"минуты часы день месяц день_недели"
"0 8 * * *" - каждый день в 8:00
"0 7,19 * * *" - в 7:00 и 19:00 каждый день
"0 9 * * 1,3,5" - в 9:00 по понедельникам, средам и пятницам`;
      
      await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Обработка неизвестных команд
    this.bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('/') && !msg.text.match(/\/(status|schedule|setschedule|water|toggle|help)/)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Неизвестная команда. Используйте /help для списка команд');
      }
    });
  }

  async sendWateringNotification(zone, action = 'started') {
    if (!this.bot || !this.chatId) return;

    try {
      const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
      const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
      const safeZoneName = this.escapeMarkdown(zoneName);
      const actionText = action === 'started' ? 'запущен' : 'завершен';
      const emoji = action === 'started' ? '💧' : '✅';
      
      const message = `${emoji} *Полив "${safeZoneName}" ${actionText}*\n\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      // Try Markdown first, fallback to plain text if it fails
      try {
        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      } catch (parseError) {
        // If Markdown parsing fails, send as plain text
        const plainMessage = message.replace(/\*/g, '').replace(/\\/g, '');
        await this.bot.sendMessage(this.chatId, plainMessage);
      }
    } catch (error) {
      logger.error('Ошибка отправки уведомления в Telegram:', error);
    }
  }

  async sendScheduledWateringNotification(zone, duration) {
    if (!this.bot || !this.chatId) return;

    try {
      const settings = this.moistureSensor.storage ? await this.moistureSensor.storage.loadSettings() : null;
      const zoneName = settings?.zones[zone]?.name || `Зона ${zone + 1}`;
      const safeZoneName = this.escapeMarkdown(zoneName);
      const message = `📅 *Запланированный полив*\n\n"${safeZoneName}" поливается по расписанию\nДлительность: ${duration} сек\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      // Try Markdown first, fallback to plain text if it fails
      try {
        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      } catch (parseError) {
        // If Markdown parsing fails, send as plain text
        const plainMessage = message.replace(/\*/g, '').replace(/\\/g, '');
        await this.bot.sendMessage(this.chatId, plainMessage);
      }
    } catch (error) {
      logger.error('Ошибка отправки уведомления о запланированном поливе:', error);
    }
  }

  escapeMarkdown(text) {
    // Escape special Markdown characters that can cause parsing errors
    return text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&');
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
      const safeMessage = this.escapeMarkdown(message);
      const fullMessage = `🔧 *Система:* ${safeMessage}`;
      
      // Try Markdown first, fallback to plain text if it fails
      try {
        await this.bot.sendMessage(this.chatId, fullMessage, { parse_mode: 'Markdown' });
      } catch (parseError) {
        // If Markdown parsing fails, send as plain text
        const plainMessage = fullMessage.replace(/\*/g, '').replace(/\\/g, '');
        await this.bot.sendMessage(this.chatId, plainMessage);
      }
    } catch (error) {
      logger.error('Ошибка отправки системного уведомления:', error);
    }
  }

  async sendWarningNotification(message) {
    if (!this.bot || !this.chatId) return;

    try {
      const safeMessage = this.escapeMarkdown(message);
      const fullMessage = `⚠️ *Предупреждение:* ${safeMessage}`;
      
      // Try Markdown first, fallback to plain text if it fails
      try {
        await this.bot.sendMessage(this.chatId, fullMessage, { parse_mode: 'Markdown' });
      } catch (parseError) {
        // If Markdown parsing fails, send as plain text
        const plainMessage = fullMessage.replace(/\*/g, '').replace(/\\/g, '');
        await this.bot.sendMessage(this.chatId, plainMessage);
      }
    } catch (error) {
      logger.error('Ошибка отправки предупреждения:', error);
    }
  }

  async sendErrorNotification(title, details) {
    if (!this.bot || !this.chatId) return;

    try {
      const safeTitle = this.escapeMarkdown(title);
      const safeDetails = this.escapeMarkdown(details);
      const message = `❌ *Ошибка:* ${safeTitle}\n\nДетали: ${safeDetails}\nВремя: ${new Date().toLocaleString('ru-RU')}`;
      
      // Try Markdown first, fallback to plain text if it fails
      try {
        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      } catch (parseError) {
        // If Markdown parsing fails, send as plain text
        const plainMessage = message.replace(/\*/g, '').replace(/\\/g, '');
        await this.bot.sendMessage(this.chatId, plainMessage);
      }
    } catch (error) {
      logger.error('Ошибка отправки уведомления об ошибке:', error);
    }
  }
}

module.exports = TelegramBotController;
