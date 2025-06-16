const config = require('./config');
const logger = require('./logger');

class PumpController {
  constructor(telegramBot = null) {
    this.telegramBot = telegramBot;
    this.relays = {};
    this.pumpStates = [];
    this.lastWatering = [];
    this.dailyWateringCount = [];
    
    // Инициализация GPIO пинов
    config.relays.forEach((pin, index) => {
      try {
        this.relays[index] = new Gpio(pin, 'out');
        this.relays[index].writeSync(1); // Выключено (активный LOW)
        this.pumpStates[index] = false;
        this.lastWatering[index] = 0;
        this.dailyWateringCount[index] = 0;
        logger.info(`Реле ${index + 1} (GPIO${pin}) инициализировано`);
      } catch (error) {
        logger.error(`Ошибка инициализации GPIO${pin}:`, error);
      }
    });
    
    // Сброс счетчика поливов каждый день в полночь
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        this.dailyWateringCount.fill(0);
        logger.info('Сброшен счетчик ежедневных поливов');
      }
    }, 60000);
  }

  async startWatering(pumpIndex) {
    if (!this.relays[pumpIndex]) {
      logger.error(`Реле ${pumpIndex + 1} не инициализировано`);
      return false;
    }

    const now = Date.now();
    
    // Проверка cooldown периода
    if (now - this.lastWatering[pumpIndex] < config.watering.cooldown) {
      const remaining = Math.round((config.watering.cooldown - (now - this.lastWatering[pumpIndex])) / 60000);
      logger.info(`Насос ${pumpIndex + 1}: ожидание ${remaining} мин до следующего полива`);
      return false;
    }
    
    // Проверка лимита поливов в день
    if (this.dailyWateringCount[pumpIndex] >= config.watering.maxDailyWatering) {
      logger.warn(`Насос ${pumpIndex + 1}: достигнут дневной лимит поливов`);
      return false;
    }

    try {
      logger.info(`Начинается полив зоны ${pumpIndex + 1}`);
      
      // Включаем насос (активный LOW)
      this.relays[pumpIndex].writeSync(0);
      this.pumpStates[pumpIndex] = true;
      
      // Автоматическое выключение через заданное время
      setTimeout(() => {
        this.stopWatering(pumpIndex);
      }, config.watering.duration);
      
      this.lastWatering[pumpIndex] = now;
      this.dailyWateringCount[pumpIndex]++;
      
      // Отправляем уведомление в Telegram
      if (this.telegramBot) {
        this.telegramBot.sendWateringNotification(pumpIndex, 'started');
      }
      
      return true;
    } catch (error) {
      logger.error(`Ошибка запуска насоса ${pumpIndex + 1}:`, error);
      return false;
    }
  }

  stopWatering(pumpIndex) {
    if (!this.relays[pumpIndex]) return false;

    try {
      this.relays[pumpIndex].writeSync(1); // Выключено
      this.pumpStates[pumpIndex] = false;
      logger.info(`Полив зоны ${pumpIndex + 1} завершен`);
      
      // Отправляем уведомление в Telegram
      if (this.telegramBot) {
        this.telegramBot.sendWateringNotification(pumpIndex, 'finished');
      }
      
      return true;
    } catch (error) {
      logger.error(`Ошибка остановки насоса ${pumpIndex + 1}:`, error);
      return false;
    }
  }

  stopAllPumps() {
    Object.keys(this.relays).forEach(index => {
      this.stopWatering(parseInt(index));
    });
  }

  getPumpStates() {
    return {
      states: this.pumpStates,
      lastWatering: this.lastWatering,
      dailyCount: this.dailyWateringCount
    };
  }

  cleanup() {
    this.stopAllPumps();
    Object.values(this.relays).forEach(relay => {
      if (relay && relay.unexport) {
        relay.unexport();
      }
    });
  }
}

module.exports = PumpController;
