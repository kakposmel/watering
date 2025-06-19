const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class Storage {
  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.historyFile = path.join(this.dataDir, 'history.json');
  }

  async initialize() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      logger.info('Storage directory initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize storage:', error);
      return false;
    }
  }

  async saveSettings(settings) {
    try {
      const fs = require('fs').promises;
      const settingsPath = path.join(this.dataDir, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      logger.debug('Настройки сохранены');
    } catch (error) {
      logger.error('Ошибка сохранения настроек:', error);
      throw error;
    }
  }

  async loadSettings() {
    try {
      const fs = require('fs').promises;
      const settingsPath = path.join(this.dataDir, 'settings.json');

      try {
        const data = await fs.readFile(settingsPath, 'utf8');
        const settings = JSON.parse(data);

        // Валидация и дополнение настроек если нужно
        if (!settings.zones || settings.zones.length !== config.relays.length) {
          return this.getDefaultSettings();
        }

        return settings;
      } catch (fileError) {
        // Файл не существует, создаем дефолтные настройки
        const defaultSettings = this.getDefaultSettings();
        await this.saveSettings(defaultSettings);
        return defaultSettings;
      }
    } catch (error) {
      logger.error('Ошибка загрузки настроек:', error);
      return this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      zones: Array(config.relays.length).fill().map((_, i) => ({
        name: `Зона ${i + 1}`,
        enabled: true,
        sensorEnabled: true,
        pumpEnabled: true,
        moistureThreshold: 'dry'
      })),
      system: {
        ledEnabled: config.led.enabled,
        telegramEnabled: !!config.telegram.token
      }
    };
  }

  async saveHistoryEntry(entry) {
    try {
      const fs = require('fs').promises;
      const historyPath = path.join(this.dataDir, 'history.json');

      let history = [];
      try {
        const data = await fs.readFile(historyPath, 'utf8');
        history = JSON.parse(data);
      } catch (fileError) {
        // Файл не существует, начинаем с пустой истории
      }

      history.push(entry);

      // Ограничиваем размер истории (последние 1000 записей)
      if (history.length > 1000) {
        history = history.slice(-1000);
      }

      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      logger.debug('Запись добавлена в историю:', entry.type);
    } catch (error) {
      logger.error('Ошибка сохранения в историю:', error);
    }
  }

  async loadHistory(limit = 100) {
    try {
      const fs = require('fs').promises;
      const historyPath = path.join(this.dataDir, 'history.json');

      try {
        const data = await fs.readFile(historyPath, 'utf8');
        const history = JSON.parse(data);
        return history.slice(-limit).reverse(); // Последние записи сначала
      } catch (fileError) {
        return []; // Файл не существует
      }
    } catch (error) {
      logger.error('Ошибка загрузки истории:', error);
      return [];
    }
  }
}

module.exports = Storage;