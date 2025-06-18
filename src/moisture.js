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
console.log('Датчик на воздухе: ', await this.readSensor(0));
console.log('Датчик в сухой земле: ', await this.readSensor(1));  
console.log('Датчик во влажной земле: ', await this.readSensor(2));
console.log('Датчик в воде: ', await this.readSensor(3));

// Запуск диагностики
await this.diagnosticTest().catch(console.error);

      return true;
    } catch (error) {
      logger.error('Ошибка инициализации ADS1x15:', error);
      return false;
    }
  }
async  diagnosticTest() {
  const adc = new ads1x15();
  await adc.openBus(1);
  
  console.log('=== ДИАГНОСТИКА ADS1115 ===\n');
  
  // 1. Проверяем все каналы
  console.log('1. Проверка всех каналов:');
  for (let channel = 0; channel <= 3; channel++) {
    try {
      const value = await adc.readSingleEnded({ channel });
      console.log(`   Канал ${channel}: ${value} мВ (${(value/1000).toFixed(2)} В)`);
    } catch (error) {
      console.log(`   Канал ${channel}: ОШИБКА - ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 2. Проверяем с разными gain настройками
  console.log('\n2. Проверка с разными gain (канал 0):');
  const gains = [
    { gain: 1, range: '±4.096V' },
    { gain: 2, range: '±2.048V' },
    { gain: 4, range: '±1.024V' },
    { gain: 8, range: '±0.512V' }
  ];
  
  for (const { gain, range } of gains) {
    try {
      const value = await adc.readSingleEnded({ 
        channel: 0, 
        gain: gain 
      });
      console.log(`   Gain ${gain} (${range}): ${value} мВ`);
    } catch (error) {
      console.log(`   Gain ${gain}: ОШИБКА - ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 3. Проверяем дифференциальное чтение
  console.log('\n3. Дифференциальное чтение:');
  try {
    const diff01 = await adc.readDifferential({ 
      positiveChannel: 0, 
      negativeChannel: 1 
    });
    console.log(`   Канал 0-1 (дифференциально): ${diff01} мВ`);
  } catch (error) {
    console.log(`   Дифференциально: ОШИБКА - ${error.message}`);
  }
  
  // 4. Множественные чтения одного канала
  console.log('\n4. Проверка стабильности (канал 0, 10 измерений):');
  const readings = [];
  for (let i = 0; i < 10; i++) {
    const value = await adc.readSingleEnded({ channel: 0 });
    readings.push(value);
    process.stdout.write(`${value} `);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  const min = Math.min(...readings);
  const max = Math.max(...readings);
  const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
  
  console.log(`\n   Мин: ${min} мВ, Макс: ${max} мВ, Среднее: ${avg.toFixed(1)} мВ`);
  console.log(`   Разброс: ${(max - min)} мВ`);
  
  // 5. Проверка с отключенным датчиком
  console.log('\n5. ОТКЛЮЧИТЕ датчик влажности и нажмите Enter для продолжения...');
  // Здесь в реальности нужен ввод пользователя
  console.log('   (симуляция отключения)');
  
  const valueDisconnected = await adc.readSingleEnded({ channel: 0 });
  console.log(`   Значение с отключенным датчиком: ${valueDisconnected} мВ`);
  
  console.log('\n=== АНАЛИЗ ===');
  
  if (min === max && readings.every(r => r === readings[0])) {
    console.log('❌ ПРОБЛЕМА: Все значения одинаковые!');
    console.log('   Возможные причины:');
    console.log('   - Датчик не подключен к правильному каналу');
    console.log('   - Проблема с питанием датчика');
    console.log('   - Неисправность ADS1115 или датчика');
  }
  
  if (avg > 3500) {
    console.log('⚠️  ВНИМАНИЕ: Высокие значения (>3.5В)');
    console.log('   Возможные причины:');
    console.log('   - ADS1115 питается от 3.3В, а входной сигнал >3.6В');
    console.log('   - Нужно использовать делитель напряжения');
    console.log('   - Или питать ADS1115 от 5В (если поддерживается)');
  }
  
  console.log('\n=== ИНСТРУКЦИИ ===');
  console.log('1. Проверьте схему подключения:');
  console.log('   Датчик VCC → 5V');
  console.log('   Датчик GND → GND');
  console.log('   Датчик A0 (аналоговый) → ADS1115 A0');
  console.log('   НЕ подключайте D0 (цифровой выход)!');
  
  console.log('\n2. Проверьте питание ADS1115:');
  console.log('   Если ADS1115 питается от 3.3В, добавьте делитель напряжения');
  console.log('   Резисторы 10кОм и 6.8кОм снизят 5В до 3.3В');
  
  console.log('\n3. Проверьте, что config.adcChannels указывает на правильный канал');
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