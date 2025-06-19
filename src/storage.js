
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
      await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
      return true;
    } catch (error) {
      logger.error('Failed to save settings:', error);
      return false;
    }
  }

  async loadSettings() {
    try {
      const data = await fs.readFile(this.settingsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default settings
        const defaultSettings = {
          zones: [
            { enabled: true, sensorEnabled: true, pumpEnabled: true },
            { enabled: true, sensorEnabled: true, pumpEnabled: true },
            { enabled: true, sensorEnabled: true, pumpEnabled: true },
            { enabled: true, sensorEnabled: true, pumpEnabled: true }
          ]
        };
        await this.saveSettings(defaultSettings);
        return defaultSettings;
      }
      logger.error('Failed to load settings:', error);
      return null;
    }
  }

  async saveHistoryEntry(entry) {
    try {
      let history = [];
      try {
        const data = await fs.readFile(this.historyFile, 'utf8');
        history = JSON.parse(data);
      } catch (error) {
        // File doesn't exist or is corrupted, start fresh
      }

      history.push(entry);
      
      // Keep only last 1000 entries to prevent file from growing too large
      if (history.length > 1000) {
        history = history.slice(-1000);
      }

      await fs.writeFile(this.historyFile, JSON.stringify(history, null, 2));
      return true;
    } catch (error) {
      logger.error('Failed to save history entry:', error);
      return false;
    }
  }

  async loadHistory(limit = 100) {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      const history = JSON.parse(data);
      return history.slice(-limit);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // No history file yet
      }
      logger.error('Failed to load history:', error);
      return [];
    }
  }
}

module.exports = Storage;
