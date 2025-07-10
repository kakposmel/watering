const { Gpio } = require('onoff');
const config = require('./config');
const logger = require('./logger');

class PumpController {
  constructor(telegramBot = null) {
    this.telegramBot = telegramBot;
    this.relays = {};
    this.pumpStates = [];
    this.lastWatering = [];
    this.dailyWateringCount = [];
    this.storage = null;
    this.lastResetDate = new Date().toDateString();

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
        this.relays[index] = null;
      }
    });

    // Сброс счетчика поливов каждый день в полночь
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        this.dailyWateringCount.fill(0);
        logger.info('Сброшен счетчик ежедневных поливов');

        // Уведомление в Telegram о сбросе счетчика
        if (this.telegramBot && this.telegramBot.bot) {
          this.telegramBot.sendSystemNotification('Счетчик ежедневных поливов сброшен');
        }
      }
    }, 60000);
  }

  setStorage(storage) {
    this.storage = storage;
  }

  async startWatering(pumpIndex) {
    return this.startWateringInternal(pumpIndex, config.watering.duration, 'manual');
  }

  async startScheduledWatering(pumpIndex, duration) {
    return this.startWateringInternal(pumpIndex, duration, 'scheduled');
  }

  async startWateringInternal(pumpIndex, duration, type = 'manual') {
    if (!this.relays[pumpIndex]) {
      const errorMsg = `Реле ${pumpIndex + 1} не инициализировано`;
      logger.error(errorMsg);

      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendErrorNotification('Ошибка реле', errorMsg);
      }
      return false;
    }

    // Check if zone and pump are enabled
    const settings = this.storage ? await this.storage.loadSettings() : null;
    const zoneSettings = settings?.zones[pumpIndex];

    if (zoneSettings && !zoneSettings.enabled) {
      logger.warn(`Зона ${pumpIndex + 1} отключена в настройках`);
      return false;
    }

    // Проверяем, не активен ли уже полив
    if (this.pumpStates[pumpIndex]) {
      logger.warn(`Насос ${pumpIndex + 1} уже работает`);
      return false;
    }

    // For manual watering, keep some basic checks
    if (type === 'manual') {
      // Проверяем время с последнего полива (только для ручного полива)
      const now = Date.now();
      const minInterval = 5 * 60 * 1000; // 5 minutes minimum between manual waterings
      if (now - this.lastWatering[pumpIndex] < minInterval) {
        const remainingTime = Math.round((minInterval - (now - this.lastWatering[pumpIndex])) / 60000);
        logger.warn(`Зона ${pumpIndex + 1}: слишком рано для ручного полива. Осталось ${remainingTime} минут`);
        return false;
      }
    }

    try {
      const now = Date.now();
      // Включаем насос
      this.relays[pumpIndex].writeSync(0); // Активный LOW
      this.pumpStates[pumpIndex] = true;
      this.lastWatering[pumpIndex] = now;
      
      // Only increment daily count for manual watering to preserve scheduling freedom
      if (type === 'manual') {
        this.dailyWateringCount[pumpIndex]++;
      }

      logger.info(`Насос ${pumpIndex + 1} включен на ${duration}мс (${type})`);

      // Уведомление в Telegram о начале полива
      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendWateringNotification(pumpIndex, 'started');
      }

      // Сохраняем в историю
      if (this.storage) {
        await this.storage.saveHistoryEntry({
          type: type === 'scheduled' ? 'scheduled_watering_started' : 'watering_started',
          zone: pumpIndex,
          timestamp: new Date(),
          duration: duration,
          dailyCount: this.dailyWateringCount[pumpIndex],
          wateringType: type
        });
        // Сохраняем состояние поливов
        await this.saveWateringState();
      }

      // Автоматическое выключение через заданное время
      setTimeout(async () => {
        await this.stopWatering(pumpIndex, true);
      }, duration);

      return true;
    } catch (error) {
      logger.error(`Ошибка запуска насоса ${pumpIndex + 1}:`, error);

      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendErrorNotification(`Ошибка насоса ${pumpIndex + 1}`, error.message);
      }

      // Убеждаемся, что насос выключен при ошибке
      this.pumpStates[pumpIndex] = false;
      try {
        this.relays[pumpIndex].writeSync(1);
      } catch (cleanupError) {
        logger.error(`Ошибка отключения насоса ${pumpIndex + 1} после ошибки:`, cleanupError);
      }

      return false;
    }
  }

  async stopWatering(pumpIndex, automatic = false) {
    if (!this.relays[pumpIndex]) {
      logger.error(`Реле ${pumpIndex + 1} не инициализировано`);
      return false;
    }

    if (!this.pumpStates[pumpIndex]) {
      logger.warn(`Насос ${pumpIndex + 1} уже выключен`);
      return false;
    }

    try {
      this.relays[pumpIndex].writeSync(1); // Выключаем (активный LOW)
      this.pumpStates[pumpIndex] = false;

      const actionType = automatic ? 'автоматически завершен' : 'принудительно остановлен';
      logger.info(`Насос ${pumpIndex + 1} ${actionType}`);

      // Уведомление в Telegram о завершении полива
      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendWateringNotification(pumpIndex, 'completed');
      }

      // Сохраняем в историю
      if (this.storage) {
        await this.storage.saveHistoryEntry({
          type: automatic ? 'watering_completed' : 'watering_stopped',
          zone: pumpIndex,
          timestamp: new Date()
        });
        // Сохраняем состояние поливов
        await this.saveWateringState();
      }

      return true;
    } catch (error) {
      logger.error(`Ошибка остановки насоса ${pumpIndex + 1}:`, error);

      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendErrorNotification(`Ошибка остановки насоса ${pumpIndex + 1}`, error.message);
      }

      return false;
    }
  }

  async stopAllPumps() {
    logger.info('Останавливаем все насосы...');
    let stoppedCount = 0;

    for (let i = 0; i < config.relays.length; i++) {
      if (this.pumpStates[i]) {
        if (await this.stopWatering(i)) {
          stoppedCount++;
        }
      }
    }

    if (stoppedCount > 0) {
      logger.info(`Остановлено насосов: ${stoppedCount}`);

      // Уведомление в Telegram об аварийной остановке
      if (this.telegramBot && this.telegramBot.bot) {
        this.telegramBot.sendSystemNotification(`Экстренно остановлено насосов: ${stoppedCount}`);
      }
    }

    return stoppedCount;
  }

  getPumpStates() {
    return {
      states: [...this.pumpStates],
      dailyCount: [...this.dailyWateringCount],
      lastWatering: [...this.lastWatering]
    };
  }

  async cleanup() {
    logger.info('Очистка ресурсов насосов...');

    // Останавливаем все насосы
    await this.stopAllPumps();

    // Освобождаем GPIO ресурсы
    Object.values(this.relays).forEach((relay, index) => {
      if (relay && relay.unexport) {
        try {
          relay.unexport();
          logger.info(`GPIO для реле ${index + 1} освобожден`);
        } catch (error) {
          logger.error(`Ошибка освобождения GPIO для реле ${index + 1}:`, error);
        }
      }
    });
  }

  async initialize() {
    try {
      for (let i = 0; i < config.relays.length; i++) {
        const pin = config.relays[i];
        this.relays[i] = new Gpio(pin, 'out');
        this.relays[i].writeSync(1); // Выключено (активный LOW)
        logger.info(`Реле ${i + 1} инициализировано на GPIO${pin}`);
      }

      // Load persistent watering state
      await this.loadWateringState();
      this.startDailyReset();
      return true;
    } catch (error) {
      logger.error('Ошибка инициализации реле:', error);
      return false;
    }
  }

  setTelegramBot(telegramBot) {
    this.telegramBot = telegramBot;
  }

  async loadWateringState() {
    if (!this.storage) return;

    try {
      const state = await this.storage.loadWateringState();
      if (state) {
        // Check if it's a new day
        const today = new Date().toDateString();
        if (state.lastResetDate === today) {
          this.lastWatering = state.lastWatering || Array(config.relays.length).fill(0);
          this.dailyWateringCount = state.dailyWateringCount || Array(config.relays.length).fill(0);
        } else {
          // New day, reset daily counts
          this.dailyWateringCount = Array(config.relays.length).fill(0);
          this.lastWatering = state.lastWatering || Array(config.relays.length).fill(0);
        }
        this.lastResetDate = today;
        await this.saveWateringState();
        logger.info('Состояние поливов загружено из хранилища');
      }
    } catch (error) {
      logger.error('Ошибка загрузки состояния поливов:', error);
    }
  }

  async saveWateringState() {
    if (!this.storage) return;

    try {
      const state = {
        lastWatering: this.lastWatering,
        dailyWateringCount: this.dailyWateringCount,
        lastResetDate: this.lastResetDate
      };
      await this.storage.saveWateringState(state);
    } catch (error) {
      logger.error('Ошибка сохранения состояния поливов:', error);
    }
  }

  startDailyReset() {
    setInterval(async () => {
      const now = new Date();
      const currentDate = now.toDateString();

      if (currentDate !== this.lastResetDate) {
        this.dailyWateringCount.fill(0);
        this.lastResetDate = currentDate;
        await this.saveWateringState();
        logger.info('Счетчик ежедневных поливов сброшен');

        if (this.telegramBot && this.telegramBot.bot) {
          this.telegramBot.sendSystemNotification('Счетчик ежедневных поливов сброшен');
        }
      }
    }, 60000);
  }
}

module.exports = PumpController;