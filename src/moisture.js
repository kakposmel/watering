const ads1x15 = require('ads1x15');
const config = require('./config');
const logger = require('./logger');

class MoistureSensor {
  constructor() {
    this.adc = new ads1x15();
    this.lastReadings = [];
    this.calibration = {
      // Калибровочные значения для YL-69 (по спецификации)
      dry: config.moisture.thresholds.dry,    // Сухая почва
      wet: config.moisture.thresholds.wet,    // Влажная почва
      water: 950   // 700-950: датчик в воде
    };
    this.busOpened = false;
  }

  async initialize() {
    try {
      if (!this.busOpened) {
        await this.adc.openBus(1); // Обычно /dev/i2c-1
        this.busOpened = true;
      }
      // Проверка чтения с первого канала
      await this.adc.readSingleEnded({ channel: 0 });
      logger.info('ADS1x15 инициализирован успешно');
      return true;
    } catch (error) {
      logger.error('Ошибка инициализации ADS1x15:', error);
      return false;
    }
  }

  async readSensor(channel) {
    try {
      const measure = await this.adc.readSingleEnded({ channel });
      // measure в милливольтах, диапазон 0-4200 мВ при питании 5В
      // Преобразуем в 16-битное значение (0-65535)
      const rawValue = Math.round((measure / 4200) * 65535);

      // Фильтрация выбросов
      if (rawValue < 0 || rawValue > 1100) {
        logger.warn(`Подозрительное значение с канала ${channel}: ${rawValue}`);
        return null;
      }

      return rawValue;
    } catch (error) {
      logger.error(`Ошибка чтения канала ${channel}:`, error);
      return null;
    }
  }

  async readAllSensors() {
    const readings = [];

    for (let i = 0; i < config.adcChannels.length; i++) {
      const channel = config.adcChannels[i];

      // Делаем 3 замера и берем медиану для надежности
      const samples = [];
      for (let j = 0; j < 3; j++) {
        const value = await this.readSensor(channel);
        if (value !== null) samples.push(value);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        readings.push({
          channel: i,
          rawValue: median,
          moisturePercent: this.getMoisturePercent(median), 
          status: this.getStatus(median), // используйте 'status', как в scheduler.js
          timestamp: new Date()
        });
      } else {
        readings.push({
          channel: i,
          rawValue: null,
          moistureStatus: 'error',
          timestamp: new Date()
        });
      }
    }

    this.lastReadings = readings;
    return readings;
  }

  getMoisturePercent(rawValue) {
  // Пример: 0% — сухо, 100% — вода
  if (rawValue === null) return null;
  const { dry, water } = this.calibration;
  if (rawValue <= dry) return 0;
  if (rawValue >= water) return 100;
  return Math.round(((rawValue - dry) / (water - dry)) * 100);
  }

  getStatus(rawValue) {
    if (rawValue === null) return 'error';

    if (rawValue <= this.calibration.dry) return 'dry';
    if (rawValue > this.calibration.dry && rawValue <= this.calibration.wet) return 'wet';
    if (rawValue > this.calibration.wet && rawValue <= this.calibration.water) return 'in_water';
    return 'out_of_range';
  }

  getLastReadings() {
    return this.lastReadings;
  }
}

module.exports = MoistureSensor;
