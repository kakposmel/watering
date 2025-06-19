// MoistureSensor.js
const ADS1115 = require('ads1115');
const i2c = require('i2c-bus');
const config = require('./config');
const logger = require('./logger');

class MoistureSensor {
  constructor() {
    this.lastReadings = [];
  }

  async initialize() {
    try {
      const bus = await i2c.openPromisified(1);
      this.adc = await ADS1115(bus);    // создаём экземпляр ADS1115
      this.adc.gain = '2/3';                // диапазон наших датчиков
      logger.info('ADS1115 инициализирован c gain=2/3');
      return true;
    } catch (err) {
      logger.error('Ошибка инициализации ADS1115:', err);
      
      // Отправляем критическую ошибку в Telegram если есть ссылка
      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendErrorNotification('Ошибка инициализации датчиков', err.message);
      }
      return false;
    }
  }

  // Чтение одного канала
  async readChannel(channel) {
    try {
      const mux = `${channel}+GND`;   // например, '0+GND'
      const mv = await this.adc.measure(mux);  // возвращает мВ
      // logger.debug(`Канал ${channel}: ${mv} мВ`); // убираем лишний лог
      return mv;
    } catch (err) {
      logger.error(`Чтение канала ${channel} не удалось:`, err);
      return null;
    }
  }

   interpretMoisture(voltage_mv) {
    const t = config.moisture.thresholds;
    let moisturePercent, status;

    if (voltage_mv > t.air) {
      moisturePercent = 0;
      status = 'air';
    } else if (voltage_mv > t.dry) {
      // dry: 0%...30%
      moisturePercent = Math.round(30 * (t.air - voltage_mv) / (t.air - t.dry));
      status = 'dry';
    } else if (voltage_mv > t.moist) {
      // moist: 31%...70%
      moisturePercent = Math.round(31 + 39 * (t.dry - voltage_mv) / (t.dry - t.moist));
      status = 'moist';
    } else if (voltage_mv > t.wet) {
      // wet: 71%...90%
      moisturePercent = Math.round(71 + 19 * (t.moist - voltage_mv) / (t.moist - t.wet));
      status = 'wet';
    } else {
      // water: 91%...100%
      moisturePercent = Math.round(91 + 9 * (t.wet - voltage_mv) / (t.wet - t.water));
      status = 'water';
    }

    moisturePercent = Math.max(0, Math.min(100, moisturePercent));
    return { rawValue: voltage_mv, moisturePercent, status };
  }
  async readAllSensors() {
    const readings = [];
    const settings = this.storage ? await this.storage.loadSettings() : null;
    
    for (let i = 0; i < config.adcChannels.length; i++) {
      const ch = config.adcChannels[i];
      const zoneSettings = settings?.zones[i];
      
      if (!zoneSettings?.enabled || !zoneSettings?.sensorEnabled) {
        readings.push({ 
          channel: ch, 
          rawValue: null, 
          moisturePercent: null, 
          status: 'disabled', 
          timestamp: new Date() 
        });
        continue;
      }
      
      const validReading = await this.getValidReading(ch);
      if (validReading !== null) {
        const res = this.interpretMoisture(validReading);
        readings.push({ channel: ch, ...res, timestamp: new Date() });
        
        // Save to history
        if (this.storage) {
          await this.storage.saveHistoryEntry({
            type: 'sensor_reading',
            zone: i,
            timestamp: new Date(),
            rawValue: validReading,
            moisturePercent: res.moisturePercent,
            status: res.status
          });
        }
      } else {
        readings.push({ channel: ch, rawValue: null, moisturePercent: null, status: 'error', timestamp: new Date() });
      }
      await new Promise(r => setTimeout(r, 100));
    }
    this.lastReadings = readings;
    return readings;
  }

  setStorage(storage) {
    this.storage = storage;
  }

  setTelegramBot(telegramBot) {
    this.telegramBot = telegramBot;
  }

  async getValidReading(channel, maxAttempts = 5) {
    const readings = [];
    
    // Take multiple readings
    for (let i = 0; i < maxAttempts; i++) {
      const mv = await this.readChannel(channel);
      if (mv !== null) {
        readings.push(mv);
      }
      await new Promise(r => setTimeout(r, 50));
    }
    
    if (readings.length === 0) return null;
    
    // If we have less than 3 readings, return the average
    if (readings.length < 3) {
      return readings.reduce((sum, val) => sum + val, 0) / readings.length;
    }
    
    // Remove outliers (values that differ more than 3000mV from median)
    readings.sort((a, b) => a - b);
    const median = readings[Math.floor(readings.length / 2)];
    const filteredReadings = readings.filter(reading => 
      Math.abs(reading - median) < 3000
    );
    
    // If too many readings were filtered out, something's wrong
    if (filteredReadings.length < readings.length * 0.6) {
      logger.warn(`Channel ${channel}: Too many outliers detected, using median`);
      return median;
    }
    
    // Return average of filtered readings
    return filteredReadings.reduce((sum, val) => sum + val, 0) / filteredReadings.length;
  }

  getLastReadings() {
    return this.lastReadings;
  }
}

module.exports = MoistureSensor;