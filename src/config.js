module.exports = {
  // GPIO пины для реле (активный LOW)
  relays: [17, 27, 22, 23],
  
  // Каналы ADS1115
  adcChannels: [0, 1, 2, 3],
  
  // Настройки полива для насосов R385
  watering: {
    duration: 10000,       // Длительность полива (10 сек для R385)
    cooldown: 3600000,     // Пауза между поливами (1 час)
    maxDailyWatering: 4    // Максимум поливов в день на зону
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
