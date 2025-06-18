const ads1x15 = require('ads1x15');
const config = require('./config');
const logger = require('./logger');

class MoistureSensor {
  constructor() {
    this.adc = new ads1x15();
    this.lastReadings = [];
    
    // Калибровка для милливольт (НЕ для 10-битных значений!)
    this.calibration = {
      // При питании датчика 5V:
      // Сухая почва: высокое сопротивление = низкое напряжение
      dry: config.moisture.thresholds.dry,    // Сухая почва
      wet: config.moisture.thresholds.wet,    // Влажная почва
      water: config.moisture.thresholds.water,    // Влажная почва
    };
    this.busOpened = false;
  }

  async initialize() {
    try {
      if (!this.busOpened) {
        await this.adc.openBus(1);
        this.busOpened = true;
      }
      
      // Тестовое чтение
      const testReading = await this.adc.readSingleEnded({ channel: 0 });
      logger.info(`ADS1x15 инициализирован. Тестовое чтение: ${testReading} мВ`);


      // Временно добавьте в код для отладки:
console.log('Датчик на воздухе: ', await sensor.readSensor(0));
console.log('Датчик в сухой земле: ', await sensor.readSensor(1));  
console.log('Датчик во влажной земле: ', await sensor.readSensor(2));
console.log('Датчик в воде: ', await sensor.readSensor(3));

      return true;
    } catch (error) {
      logger.error('Ошибка инициализации ADS1x15:', error);
      return false;
    }
  }

  async readSensor(channel) {
    try {
      // measure уже в милливольтах!
      const measure = await this.adc.readSingleEnded({ channel });
      
      // Логируем сырые значения для отладки
      logger.debug(`Канал ${channel}: ${measure} мВ (${measure/1000} В)`);
      
      // Проверка разумности значений (0-4200 мВ)
      if (measure < 0 || measure > 4500) {
        logger.warn(`Подозрительное значение с канала ${channel}: ${measure} мВ`);
        return null;
      }

      return Math.round(measure);
    } catch (error) {
      logger.error(`Ошибка чтения канала ${channel}:`, error);
      return null;
    }
  }

  async readAllSensors() {
    const readings = [];

    for (let i = 0; i < config.adcChannels.length; i++) {
      const channel = config.adcChannels[i];

      // 3 замера для надежности
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
          voltage: Math.round(median) / 1000, // Вольты для удобства
          moisturePercent: this.getMoisturePercent(median),
          status: this.getStatus(median),
          timestamp: new Date()
        });
        
        logger.info(`Канал ${i}: ${median} мВ, ${this.getStatus(median)}, ${this.getMoisturePercent(median)}%`);
      } else {
        readings.push({
          channel: i,
          rawValue: null,
          voltage: null,
          moisturePercent: null,
          status: 'error',
          timestamp: new Date()
        });
      }
    }

    this.lastReadings = readings;
    return readings;
  }

  getMoisturePercent(milliVolts) {
    if (milliVolts === null) return null;
    
    const { dry, water } = this.calibration;
    
    // Инвертируем логику: чем больше напряжение, тем больше влажность
    if (milliVolts <= dry) return 0;    // Сухо
    if (milliVolts >= water) return 100; // Максимальная влажность
    
    return Math.round(((milliVolts - dry) / (water - dry)) * 100);
  }

  getStatus(milliVolts) {
    if (milliVolts === null) return 'error';

    const { dry, wet, water } = this.calibration;

    if (milliVolts <= dry) return 'dry';
    if (milliVolts > dry && milliVolts <= wet) return 'moist';
    if (milliVolts > wet && milliVolts <= water) return 'wet';
    return 'in_water';
  }

  getLastReadings() {
    return this.lastReadings;
  }
}

module.exports = MoistureSensor;