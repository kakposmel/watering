const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

class AutoWateringScheduler {
  constructor(moistureSensor, pumpController, telegramBot = null, ledController = null) {
    this.moistureSensor = moistureSensor;
    this.pumpController = pumpController;
    this.telegramBot = telegramBot;
    this.ledController = ledController;
    this.isRunning = false;
  }

  async checkAndWater() {
    if (this.isRunning) {
      logger.warn('Предыдущая проверка еще выполняется, пропускаем...');
      return;
    }

    this.isRunning = true;
    
    try {
      logger.info('Начинается проверка влажности...');
      const readings = await this.moistureSensor.readAllSensors();
      
      // Обновляем LED на основе средней влажности
      if (this.ledController) {
        this.ledController.updateFromSensorReadings(readings);
      }
      
      for (let i = 0; i < readings.length; i++) {
        const reading = readings[i];
        
        if (reading.status === 'error') {
          logger.error(`Ошибка чтения датчика ${i + 1}`);
          continue;
        }
        
        logger.info(`Зона ${i + 1}: ${reading.moisturePercent}% (${reading.rawValue}: ${reading.status})`);
        
        // Автоматический полив при сухой почве
        if (reading.status === 'dry' || reading.status === 'air') {
          const success = await this.pumpController.startWatering(i);
          if (success) {
            logger.info(`Автополив зоны ${i + 1} запущен`);
            
            // Отправляем уведомление об автоматическом поливе
            if (this.telegramBot) {
              this.telegramBot.sendAutomaticWateringNotification(i, reading.status);
            }
          } else {
            logger.warn(`Не удалось запустить автополив зоны ${i + 1}`);
          }
        } else if (reading.status === 'water') {
          const warningMsg = `Зона ${i + 1}: переувлажнение! Проверьте дренаж и отключите полив.`;
          logger.warn(warningMsg);
          if (this.telegramBot) {
            this.telegramBot.sendWarningNotification(warningMsg);
          }
        }
      }
      
    } catch (error) {
      logger.error('Ошибка при проверке и поливе:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    logger.info(`Запуск планировщика: ${config.schedule}`);
    
    // Планировщик проверок
    cron.schedule(config.schedule, () => {
      this.checkAndWater();
    });
    
    // Первоначальная проверка через 30 секунд после запуска
    setTimeout(() => {
      this.checkAndWater();
    }, 30000);
  }
}

module.exports = AutoWateringScheduler;
