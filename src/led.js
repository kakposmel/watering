
const ws281x = require('rpi-ws281x-native');
const config = require('./config');
const logger = require('./logger');

class LEDController {
  constructor() {
    this.numLEDs = 1; // Single LED for moisture indication
    this.channel = ws281x(this.numLEDs, {
      freq: 800000,     // 800kHz
      dmaNum: 10,       // DMA channel
      gpio: config.led.dataPin,  // GPIO pin for data
      brightness: config.led.brightness,
      stripType: 'ws2812'
    });
    this.isInitialized = false;
  }

  initialize() {
    try {
      // Clear LED on startup
      this.setColor(0, 0, 0);
      this.render();
      this.isInitialized = true;
      logger.info(`LED controller инициализирован на GPIO${config.led.dataPin}`);
      return true;
    } catch (error) {
      logger.error('Ошибка инициализации LED контроллера:', error);
      return false;
    }
  }

  // Convert RGB to single color value
  rgb2Int(r, g, b) {
    return ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff);
  }

  // Set LED color
  setColor(r, g, b) {
    if (!this.isInitialized) return;
    
    try {
      this.channel.array[0] = this.rgb2Int(r, g, b);
    } catch (error) {
      logger.error('Ошибка установки цвета LED:', error);
    }
  }

  // Apply changes to LED
  render() {
    if (!this.isInitialized) return;
    
    try {
      ws281x.render();
    } catch (error) {
      logger.error('Ошибка вывода на LED:', error);
    }
  }

  // Update LED based on moisture level
  updateMoistureLevel(moistureLevel) {
    if (!this.isInitialized || moistureLevel === null) {
      // No data - dim white
      this.setColor(50, 50, 50);
      this.render();
      return;
    }

    // Convert raw sensor value to moisture percentage
    const { dry, wet } = config.moisture.thresholds;
    let moisturePercent;
    
    if (moistureLevel <= dry) {
      moisturePercent = 0; // Completely dry
    } else if (moistureLevel >= wet) {
      moisturePercent = 100; // Completely wet
    } else {
      // Linear interpolation between dry and wet
      moisturePercent = ((moistureLevel - dry) / (wet - dry)) * 100;
    }

    // Create gradient from red (dry) to green (wet)
    let r, g, b;
    
    if (moisturePercent <= 50) {
      // Red to yellow gradient (0% to 50%)
      r = 255;
      g = Math.round((moisturePercent / 50) * 255);
      b = 0;
    } else {
      // Yellow to green gradient (50% to 100%)
      r = Math.round(255 - ((moisturePercent - 50) / 50) * 255);
      g = 255;
      b = 0;
    }

    this.setColor(r, g, b);
    this.render();
    
    logger.debug(`LED обновлен: влажность ${moisturePercent.toFixed(1)}%, RGB(${r},${g},${b})`);
  }

  // Update LED based on average moisture from all sensors
  updateFromSensorReadings(readings) {
    if (!readings || readings.length === 0) {
      this.updateMoistureLevel(null);
      return;
    }

    // Calculate average moisture from valid readings
    const validReadings = readings.filter(r => r.rawValue !== null);
    
    if (validReadings.length === 0) {
      this.updateMoistureLevel(null);
      return;
    }

    const averageMoisture = validReadings.reduce((sum, r) => sum + r.rawValue, 0) / validReadings.length;
    this.updateMoistureLevel(averageMoisture);
  }

  // Set specific status colors
  setStatusColor(status) {
    if (!this.isInitialized) return;

    switch (status) {
      case 'dry':
        this.setColor(255, 0, 0); // Red
        break;
      case 'needs_water':
        this.setColor(255, 165, 0); // Orange
        break;
      case 'optimal':
        this.setColor(0, 255, 0); // Green
        break;
      case 'too_wet':
        this.setColor(0, 0, 255); // Blue
        break;
      case 'error':
      default:
        this.setColor(50, 50, 50); // Dim white
        break;
    }
    this.render();
  }

  // Cleanup
  cleanup() {
    if (this.isInitialized) {
      this.setColor(0, 0, 0);
      this.render();
      ws281x.reset();
      logger.info('LED контроллер очищен');
    }
  }
}

module.exports = LEDController;
