module.exports = {
  // GPIO пины для реле (активный LOW)
  relays: [17, 27, 22, 23],
  
  // Каналы ADS1115
  adcChannels: [0, 1, 2, 3],
  
  // Настройки полива для насосов R385
  watering: {
    duration: 10000,       // Длительность полива (10 сек для R385)
    cooldown: 3600000,     // Пауза между поливами (1 час)
    maxDailyWatering: 2    // Максимум поливов в день на зону
  },
  
  // Настройки LED индикатора (NeoPixel)
  led: {
    enabled: false,        // Включить/выключить LED индикатор
    dataPin: 18,           // GPIO18 (PWM0) - рекомендуемый пин для NeoPixel
    brightness: 128        // Яркость 0-255 (50% для экономии энергии)
  },
  
  // Пороги влажности почвы
  moisture: {
    thresholds: {
      air: 27800,     // >27800 — воздух
      dry: 19000,     // 19000–27800 — сухо
      moist: 13000,   // 13000–19000 — влажно
      wet: 5000,      // 5000–13000 — хорошо
      water: 0        // <5000 — вода
    }
  },
  // I²C адрес ADS1115
  adcAddress: 0x48,
  
  // Веб-сервер
  server: {
    port: 3000
  },
  
  // Расписание проверок
  schedule: '*/15 * * * *', // Каждые 15 минут
  
  // Telegram bot настройки
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '', // Токен бота из BotFather
    chatId: process.env.TELEGRAM_CHAT_ID || ''   // ID чата для уведомлений
  }
};
