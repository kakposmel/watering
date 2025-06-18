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
      this.adc.gain = 1;                // ±4.096 В (диапазон наших датчиков)
      logger.info('ADS1115 инициализирован c gain=±4.096 В');
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
      logger.debug(`Канал ${channel}: ${mv} мВ`);
      return mv;
    } catch (err) {
      logger.error(`Чтение канала ${channel} не удалось:`, err);
      return null;
    }
  }

  interpretMoisture(voltage_mv, channel) {
    let moisture, status;

    if (voltage_mv >= 3500) {
      moisture = 0; status = 'dry/air';
    } else if (voltage_mv >= 2500) {
      moisture = Math.round((3500 - voltage_mv) / 10); status = 'dry';
    } else if (voltage_mv >= 1500) {
      moisture = Math.round(30 + (2500 - voltage_mv) / 10); status = 'moist';
    } else if (voltage_mv >= 800) {
      moisture = Math.round(60 + (1500 - voltage_mv) / 10); status = 'wet';
    } else {
      moisture = Math.round(80 + (800 - voltage_mv) / 20); status = 'water';
    }

    moisture = Math.max(0, Math.min(100, moisture));
    logger.info(`Канал ${channel}: ${voltage_mv} мВ → ${status} (${moisture}%)`);
    return { voltage: voltage_mv, moisture, status };
  }

  async readAllSensors() {
    const readings = [];
    for (const ch of config.adcChannels) {
      const mv = await this.readChannel(ch);
      if (mv !== null) {
        const res = this.interpretMoisture(mv, ch);
        readings.push({ channel: ch, ...res, timestamp: new Date() });
      } else {
        readings.push({ channel: ch, voltage: null, moisture: null, status: 'error', timestamp: new Date() });
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
