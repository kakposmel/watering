const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

class AutoWateringScheduler {
  constructor(moistureSensor, pumpController, telegramBot = null) {
    this.moistureSensor = moistureSensor;
    this.pumpController = pumpController;
    this.telegramBot = telegramBot;
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
      
      for (let i = 0; i < readings.length; i++) {
        const reading = readings[i];
        
        if (reading.status === 'error') {
          logger.error(`Ошибка чтения датчика ${i + 1}`);
          continue;
        }
        
        logger.info(`Зона ${i + 1}: ${reading.moisturePercent}% (${reading.status})`);
        
        // Автоматический полив при сухой почве
        if (reading.status === 'dry' || reading.status === 'needs_water') {
          const success = await this.pumpController.startWatering(i);
          if (success) {
            logger.info(`Автополив зоны ${i + 1} запущен`);
            
            // Отправляем уведомление об автоматическом поливе
            if (this.telegramBot) {
              this.telegramBot.sendAutomaticWateringNotification(i, reading.status);
            }
          }
        } else if (reading.status === 'too_wet') {
          logger.warn(`Зона ${i + 1}: слишком влажно! Проверьте дренаж.`);
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
