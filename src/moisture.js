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
    for (const ch of config.adcChannels) {
      const mv = await this.readChannel(ch);
      if (mv !== null) {
        const res = this.interpretMoisture(mv);
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