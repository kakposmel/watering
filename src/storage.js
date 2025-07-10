const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const config = require('./config'); 

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
    const defaultSchedules = [
      '0 8 * * *',   // Zone 1: 8:00 AM daily
      '0 18 * * *',  // Zone 2: 6:00 PM daily  
      '0 7,19 * * *', // Zone 3: 7:00 AM and 7:00 PM daily
      '0 9 * * 1,3,5' // Zone 4: 9:00 AM Monday, Wednesday, Friday
    ];
    const defaultDurations = [15, 12, 10, 20]; // seconds

    return {
      zones: Array(config.relays.length).fill().map((_, i) => ({
        name: `Зона ${i + 1}`,
        enabled: true,
        scheduleEnabled: true,
        schedule: defaultSchedules[i] || '0 8 * * *',
        waterDuration: defaultDurations[i] || 15
      })),
      system: {
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
        
        // Filter entries older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const filteredHistory = history.filter(entry => 
          new Date(entry.timestamp) > thirtyDaysAgo
        );
        
        // Save filtered history back to file if we removed old entries
        if (filteredHistory.length !== history.length) {
          await fs.writeFile(historyPath, JSON.stringify(filteredHistory, null, 2));
        }
        
        return filteredHistory.slice(-limit).reverse(); // Последние записи сначала
      } catch (fileError) {
        return []; // Файл не существует
      }
    } catch (error) {
      logger.error('Ошибка загрузки истории:', error);
      return [];
    }
  }

  async saveWateringState(state) {
    try {
      const fs = require('fs').promises;
      const statePath = path.join(this.dataDir, 'watering_state.json');
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));
      logger.debug('Состояние поливов сохранено');
    } catch (error) {
      logger.error('Ошибка сохранения состояния поливов:', error);
      throw error;
    }
  }

  async loadWateringState() {
    try {
      const fs = require('fs').promises;
      const statePath = path.join(this.dataDir, 'watering_state.json');

      try {
        const data = await fs.readFile(statePath, 'utf8');
        return JSON.parse(data);
      } catch (fileError) {
        return null; // Файл не существует
      }
    } catch (error) {
      logger.error('Ошибка загрузки состояния поливов:', error);
      return null;
    }
  }

  async updateZoneName(zoneIndex, newName) {
    try {
      const settings = await this.loadSettings();
      if (settings.zones[zoneIndex]) {
        settings.zones[zoneIndex].name = newName;
        await this.saveSettings(settings);
        logger.debug(`Зона ${zoneIndex + 1} переименована в "${newName}"`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Ошибка переименования зоны:', error);
      throw error;
    }
  }
}

module.exports = Storage;