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

      return true;
    } catch (error) {
      logger.error('Ошибка инициализации ADS1x15:', error);
      return false;
    }
  }

 async readSensor(channel) {
  try {
    // Используем меньший диапазон для лучшей точности
    // PGA 4096 = ±4.096V - оптимально для датчиков 0-4.2V
    const measure = await this.adc.readSingleEnded({
      channel: channel,
      pga: 4096,    // ±4.096V диапазон (было 6144)
      sps: 128      // Уменьшим частоту для стабильности (было 250)
    });
    
    // Логируем сырые значения для отладки
    logger.debug(`Канал ${channel}: ${measure} мВ (${measure/1000} В)`);
    
    // Расширим допустимый диапазон для диагностики
    if (measure < -100 || measure > 4300) {
      logger.warn(`Подозрительное значение с канала ${channel}: ${measure} мВ`);
      
      // Попробуем повторное чтение с задержкой
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const retryMeasure = await this.adc.readSingleEnded({
        channel: channel,
        pga: 4096,
        sps: 128
      });
      
      logger.debug(`Повторное чтение канала ${channel}: ${retryMeasure} мВ`);
      
      if (retryMeasure < -100 || retryMeasure > 4300) {
        logger.error(`Канал ${channel}: стабильно некорректные значения. Проверьте подключение.`);
        return null;
      }
      
      return Math.round(retryMeasure);
    }
    
    return Math.round(measure);
  } catch (error) {
    logger.error(`Ошибка чтения канала ${channel}:`, error);
    return null;
  }
}

// Добавьте функцию для калибровки и интерпретации значений
interpretMoisture(voltage_mv, channel) {
  // Инвертированная логика: 
  // Высокое напряжение = сухо (воздух)
  // Низкое напряжение = влажно (вода)
  
  let moisturePercent;
  let status;
  
  if (voltage_mv >= 3500) {
    // Очень сухо / воздух
    moisturePercent = 0;
    status = 'dry/air';
  } else if (voltage_mv >= 2500) {
    // Сухая почва
    moisturePercent = Math.round((3500 - voltage_mv) / 10);
    status = 'dry';
  } else if (voltage_mv >= 1500) {
    // Влажная почва
    moisturePercent = Math.round(30 + (2500 - voltage_mv) / 10);
    status = 'moist';
  } else if (voltage_mv >= 800) {
    // Очень влажно
    moisturePercent = Math.round(60 + (1500 - voltage_mv) / 10);
    status = 'wet';
  } else {
    // Вода
    moisturePercent = Math.round(80 + (800 - voltage_mv) / 20);
    status = 'water';
  }
  
  // Ограничиваем диапазон 0-100%
  moisturePercent = Math.max(0, Math.min(100, moisturePercent));
  
  logger.info(`Канал ${channel}: ${voltage_mv} мВ, ${status}, ${moisturePercent}%`);
  
  return {
    voltage: voltage_mv,
    moisture: moisturePercent,
    status: status
  };
}

// Функция для диагностики всех каналов
async diagnoseSensors() {
  logger.info('=== Диагностика датчиков ===');
  
  for (let channel = 0; channel < 4; channel++) {
    const voltage = await this.readSensor(channel);
    if (voltage !== null) {
      const result = this.interpretMoisture(voltage, channel);
      logger.info(`Канал ${channel}: ${result.voltage}мВ -> ${result.status} (${result.moisture}%)`);
    } else {
      logger.error(`Канал ${channel}: Не удалось прочитать`);
    }
    
    // Задержка между чтениями
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  logger.info('=== Ожидаемые значения ===');
  logger.info('Канал 0 (воздух): ~3500-4000 мВ');
  logger.info('Канал 1 (сухая почва): ~2500-3500 мВ');
  logger.info('Канал 2 (влажная почва): ~1500-2500 мВ');
  logger.info('Канал 3 (вода): ~500-1500 мВ');
}

  

  async readAllSensors() {
    await this.diagnoseSensors();
    
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