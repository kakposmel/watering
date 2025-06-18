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
      this.adc.gain = 1;                // диапазон наших датчиков
      logger.info('ADS1115 инициализирован c gain=2/3');
      return true;
    } catch (err) {
      logger.error('Ошибка инициализации ADS1115:', err);
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

  interpretMoisture(voltage_mv, channel) {
    let moisturePercent, status;

    if (voltage_mv > 27800) {
      moisturePercent = 0;
      status = 'air';
    } else if (voltage_mv > 19000) {
      // dry: 0%...30%
      moisturePercent = Math.round(30 * (27800 - voltage_mv) / (27800 - 19000));
      status = 'dry';
    } else if (voltage_mv > 10000) {
      // moist: 31%...70%
      moisturePercent = Math.round(31 + 39 * (19000 - voltage_mv) / (19000 - 10000));
      status = 'moist';
    } else if (voltage_mv > 8000) {
      // wet: 71%...90%
      moisturePercent = Math.round(71 + 19 * (10000 - voltage_mv) / (10000 - 8000));
      status = 'wet';
    } else {
      // water: 91%...100%
      moisturePercent = Math.round(91 + 9 * (8000 - voltage_mv) / 8000);
      status = 'water';
    }

    moisturePercent = Math.max(0, Math.min(100, moisturePercent));
    // logger.info(`Канал ${channel}: ${voltage_mv} мВ → ${status} (${moisturePercent}%)`); // убираем лишний лог
    return { rawValue: voltage_mv, moisturePercent, status };
  }

  async readAllSensors() {
    const readings = [];
    for (const ch of config.adcChannels) {
      const mv = await this.readChannel(ch);
      if (mv !== null) {
        const res = this.interpretMoisture(mv, ch);
        readings.push({ channel: ch, ...res, timestamp: new Date() });
      } else {
        readings.push({ channel: ch, rawValue: null, moisturePercent: null, status: 'error', timestamp: new Date() });
      }
      await new Promise(r => setTimeout(r, 100));
    }
    this.lastReadings = readings;
    return readings;
  }

  getLastReadings() {
    return this.lastReadings;
  }
}

module.exports = MoistureSensor;