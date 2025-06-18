const ads1x15 = require('ads1x15');
const config = require('./config');
const logger = require('./logger');

class MoistureSensor {
  constructor() {
    this.adc = new ads1x15();
    this.lastReadings = [];

    // Калибровка для милливольт (НЕ для 10-битных значений!)
    this.calibration = {
      dry: config.moisture.thresholds.dry,      // Сухая почва (~сухой предел)
      wet: config.moisture.thresholds.wet,      // Влажная почва (~середина)
      water: config.moisture.thresholds.water   // Вода (самое низкое напряжение)
    };

    this.busOpened = false;
  }

  async initialize() {
    try {
      if (!this.busOpened) {
        await this.adc.openBus(1);
        this.busOpened = true;
      }

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
      const measure = await this.adc.readSingleEnded({
        channel: channel,
        pga: 4096,
        sps: 128
      });

      logger.debug(`Канал ${channel}: ${measure} мВ (${measure / 1000} В)`);

      if (measure < -100 || measure > 4300) {
        logger.warn(`Подозрительное значение с канала ${channel}: ${measure} мВ`);

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

  interpretMoisture(voltage_mv, channel) {
    // Высокое напряжение = сухо (воздух), низкое = влажно (вода)
    let moisturePercent;
    let status;

    if (voltage_mv >= 3500) {
      moisturePercent = 0;
      status = 'dry/air';
    } else if (voltage_mv >= 2500) {
      moisturePercent = Math.round((3500 - voltage_mv) / 10);
      status = 'dry';
    } else if (voltage_mv >= 1500) {
      moisturePercent = Math.round(30 + (2500 - voltage_mv) / 10);
      status = 'moist';
    } else if (voltage_mv >= 800) {
      moisturePercent = Math.round(60 + (1500 - voltage_mv) / 10);
      status = 'wet';
    } else {
      moisturePercent = Math.round(80 + (800 - voltage_mv) / 20);
      status = 'water';
    }

    moisturePercent = Math.max(0, Math.min(100, moisturePercent));

    logger.info(`Канал ${channel}: ${voltage_mv} мВ, ${status}, ${moisturePercent}%`);

    return {
      voltage: voltage_mv,
      moisture: moisturePercent,
      status: status
    };
  }

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
      const samples = [];

      for (let j = 0; j < 3; j++) {
        const value = await this.readSensor(channel);
        if (value !== null) samples.push(value);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        const result = this.interpretMoisture(median, i);

        readings.push({
          channel: i,
          rawValue: median,
          voltage: median / 1000,
          moisturePercent: result.moisture,
          status: result.status,
          timestamp: new Date()
        });

        logger.info(`Канал ${i}: ${median} мВ, ${result.status}, ${result.moisture}%`);
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

  getLastReadings() {
    return this.lastReadings;
  }
}

module.exports = MoistureSensor;
