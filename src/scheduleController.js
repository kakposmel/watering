const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

class ScheduleController {
  constructor(pumpController, telegramBot = null) {
    this.pumpController = pumpController;
    this.telegramBot = telegramBot;
    this.scheduledJobs = new Map(); // zone -> cron job
    this.storage = null;
    this.defaultSchedules = [
      '0 8 * * *',   // Zone 1: 8:00 AM daily
      '0 18 * * *',  // Zone 2: 6:00 PM daily  
      '0 7,19 * * *', // Zone 3: 7:00 AM and 7:00 PM daily
      '0 9 * * 1,3,5' // Zone 4: 9:00 AM Monday, Wednesday, Friday
    ];
    this.defaultDurations = [
      15, // Zone 1: 15 seconds
      12, // Zone 2: 12 seconds
      10, // Zone 3: 10 seconds
      20  // Zone 4: 20 seconds
    ];
  }

  setStorage(storage) {
    this.storage = storage;
  }

  async initialize() {
    try {
      // Load schedule settings and start cron jobs
      await this.loadAndStartSchedules();
      logger.info('Schedule controller initialized');
      return true;
    } catch (error) {
      logger.error('Error initializing schedule controller:', error);
      return false;
    }
  }

  async loadAndStartSchedules() {
    const settings = this.storage ? await this.storage.loadSettings() : null;
    
    for (let i = 0; i < config.relays.length; i++) {
      const zoneSettings = settings?.zones[i];
      
      if (zoneSettings?.enabled && zoneSettings?.scheduleEnabled) {
        const schedule = zoneSettings.schedule || this.defaultSchedules[i] || '0 8 * * *';
        const duration = zoneSettings.waterDuration || this.defaultDurations[i] || 15;
        
        await this.startZoneSchedule(i, schedule, duration);
      }
    }
  }

  async startZoneSchedule(zoneIndex, cronSchedule, waterDuration) {
    // Stop existing schedule for this zone
    await this.stopZoneSchedule(zoneIndex);
    
    try {
      // Validate cron schedule with node-cron
      if (!cron.validate(cronSchedule)) {
        logger.error(`Invalid cron schedule for zone ${zoneIndex + 1}: ${cronSchedule}`);
        return false;
      }

      const job = cron.schedule(cronSchedule, async () => {
        await this.executeScheduledWatering(zoneIndex, waterDuration);
      }, {
        scheduled: false // Start manually
      });

      this.scheduledJobs.set(zoneIndex, job);
      job.start();
      
      logger.info(`Zone ${zoneIndex + 1} schedule started: ${cronSchedule} for ${waterDuration}s`);
      return true;
    } catch (error) {
      logger.error(`Error starting schedule for zone ${zoneIndex + 1}:`, error);
      return false;
    }
  }

  async stopZoneSchedule(zoneIndex) {
    const existingJob = this.scheduledJobs.get(zoneIndex);
    if (existingJob) {
      existingJob.stop();
      existingJob.destroy();
      this.scheduledJobs.delete(zoneIndex);
      logger.info(`Zone ${zoneIndex + 1} schedule stopped`);
    }
  }

  async executeScheduledWatering(zoneIndex, duration) {
    try {
      const settings = this.storage ? await this.storage.loadSettings() : null;
      const zoneSettings = settings?.zones[zoneIndex];
      const zoneName = zoneSettings?.name || `Zone ${zoneIndex + 1}`;

      // Check if zone is still enabled
      if (!zoneSettings?.enabled || !zoneSettings?.scheduleEnabled) {
        logger.warn(`Scheduled watering skipped for ${zoneName} - zone disabled`);
        return;
      }

      logger.info(`Starting scheduled watering for ${zoneName} (${duration}s)`);

      // Use custom duration for this watering
      const success = await this.pumpController.startScheduledWatering(zoneIndex, duration * 1000);
      
      if (success) {
        logger.info(`Scheduled watering started for ${zoneName}`);
        
        // Send notification
        if (this.telegramBot) {
          await this.telegramBot.sendScheduledWateringNotification(zoneIndex, duration);
        }

        // Save to history
        if (this.storage) {
          await this.storage.saveHistoryEntry({
            type: 'scheduled_watering',
            zone: zoneIndex,
            timestamp: new Date(),
            duration: duration * 1000,
            schedule: zoneSettings.schedule
          });
        }
      } else {
        logger.warn(`Failed to start scheduled watering for ${zoneName}`);
        
        if (this.telegramBot) {
          await this.telegramBot.sendWarningNotification(
            `Не удалось запустить запланированный полив для ${zoneName}`
          );
        }
      }
    } catch (error) {
      logger.error(`Error executing scheduled watering for zone ${zoneIndex + 1}:`, error);
      
      if (this.telegramBot) {
        await this.telegramBot.sendErrorNotification(
          'Ошибка запланированного полива',
          `Zone ${zoneIndex + 1}: ${error.message}`
        );
      }
    }
  }

  async updateZoneSchedule(zoneIndex, schedule, duration, enabled = true) {
    try {
      const settings = this.storage ? await this.storage.loadSettings() : { zones: [] };
      
      // Ensure zones array exists and has enough elements
      while (settings.zones.length <= zoneIndex) {
        settings.zones.push({
          name: `Zone ${settings.zones.length + 1}`,
          enabled: true,
          scheduleEnabled: true
        });
      }

      settings.zones[zoneIndex].schedule = schedule;
      settings.zones[zoneIndex].waterDuration = duration;
      settings.zones[zoneIndex].scheduleEnabled = enabled;

      if (this.storage) {
        await this.storage.saveSettings(settings);
      }

      // Restart the schedule for this zone
      if (enabled && settings.zones[zoneIndex].enabled) {
        await this.startZoneSchedule(zoneIndex, schedule, duration);
      } else {
        await this.stopZoneSchedule(zoneIndex);
      }

      logger.info(`Zone ${zoneIndex + 1} schedule updated: ${schedule}, ${duration}s, enabled: ${enabled}`);
      return true;
    } catch (error) {
      logger.error(`Error updating schedule for zone ${zoneIndex + 1}:`, error);
      return false;
    }
  }

  async getNextWateringTime(zoneIndex) {
    try {
      const settings = this.storage ? await this.storage.loadSettings() : null;
      const zoneSettings = settings?.zones[zoneIndex];
      
      if (!zoneSettings?.enabled || !zoneSettings?.scheduleEnabled || !zoneSettings?.schedule) {
        return null;
      }

      const schedule = zoneSettings.schedule;
      
      // Simple next time calculation for common patterns
      return this.calculateNextExecution(schedule);
    } catch (error) {
      logger.error(`Error calculating next watering time for zone ${zoneIndex + 1}:`, error);
      return null;
    }
  }

  calculateNextExecution(cronExpression) {
    try {
      const parts = cronExpression.split(' ');
      if (parts.length !== 5) return null;
      
      const [minute, hour, day, month, dayOfWeek] = parts;
      const now = new Date();
      const next = new Date(now);
      
      // Handle simple daily schedules (most common case)
      if (day === '*' && month === '*' && dayOfWeek === '*') {
        const targetHour = parseInt(hour);
        const targetMinute = parseInt(minute);
        
        if (isNaN(targetHour) || isNaN(targetMinute)) {
          // Handle multiple hours like "7,19"
          if (hour.includes(',')) {
            const hours = hour.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h));
            let nextHour = null;
            
            for (const h of hours) {
              if (h > now.getHours() || (h === now.getHours() && targetMinute > now.getMinutes())) {
                nextHour = h;
                break;
              }
            }
            
            if (nextHour === null) {
              // Next execution is tomorrow at first hour
              next.setDate(next.getDate() + 1);
              next.setHours(hours[0], targetMinute, 0, 0);
            } else {
              next.setHours(nextHour, targetMinute, 0, 0);
            }
            return next;
          }
          return null;
        }
        
        next.setHours(targetHour, targetMinute, 0, 0);
        
        // If time has passed today, move to tomorrow
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        
        return next;
      }
      
      // Handle weekly schedules
      if (day === '*' && month === '*' && dayOfWeek !== '*') {
        const targetHour = parseInt(hour);
        const targetMinute = parseInt(minute);
        
        if (isNaN(targetHour) || isNaN(targetMinute)) return null;
        
        const daysOfWeek = dayOfWeek.split(',').map(d => parseInt(d.trim()));
        const currentDay = now.getDay();
        
        let nextDay = null;
        let daysToAdd = 0;
        
        // Find next matching day
        for (let i = 0; i < 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (daysOfWeek.includes(checkDay)) {
            if (i === 0) {
              // Today - check if time hasn't passed
              const todayTarget = new Date(now);
              todayTarget.setHours(targetHour, targetMinute, 0, 0);
              if (todayTarget > now) {
                return todayTarget;
              }
            } else {
              daysToAdd = i;
              break;
            }
          }
        }
        
        if (daysToAdd > 0) {
          next.setDate(next.getDate() + daysToAdd);
          next.setHours(targetHour, targetMinute, 0, 0);
          return next;
        }
        
        return null;
      }
      
      // For complex patterns, return null (fallback)
      return null;
    } catch (error) {
      logger.error('Error in calculateNextExecution:', error);
      return null;
    }
  }


  async getAllScheduleInfo() {
    const scheduleInfo = [];
    
    for (let i = 0; i < config.relays.length; i++) {
      const job = this.scheduledJobs.get(i);
      const nextTime = await this.getNextWateringTime(i);
      
      // Get schedule from settings if job doesn't exist
      const settings = this.storage ? await this.storage.loadSettings() : null;
      const zoneSettings = settings?.zones[i];
      const cronPattern = job ? (job.options?.cronExpression || zoneSettings?.schedule) : zoneSettings?.schedule;
      
      scheduleInfo.push({
        zone: i,
        active: !!job,
        nextWatering: nextTime,
        cronPattern: cronPattern || null
      });
    }
    
    return scheduleInfo;
  }

  async restartAllSchedules() {
    logger.info('Restarting all zone schedules...');
    
    // Stop all existing schedules
    for (const [zoneIndex] of this.scheduledJobs) {
      await this.stopZoneSchedule(zoneIndex);
    }
    
    // Reload and start schedules
    await this.loadAndStartSchedules();
  }

  async resetToDefaultSchedules() {
    logger.info('Resetting all schedules to defaults...');
    
    // Stop all existing schedules
    for (const [zoneIndex] of this.scheduledJobs) {
      await this.stopZoneSchedule(zoneIndex);
    }
    
    // Reset to default schedules
    for (let i = 0; i < config.relays.length; i++) {
      const schedule = this.defaultSchedules[i] || '0 8 * * *';
      const duration = this.defaultDurations[i] || 15;
      
      await this.updateZoneSchedule(i, schedule, duration, true);
    }
    
    logger.info('All schedules reset to defaults');
  }

  async cleanup() {
    logger.info('Cleaning up schedule controller...');
    
    for (const [zoneIndex] of this.scheduledJobs) {
      await this.stopZoneSchedule(zoneIndex);
    }
    
    logger.info('Schedule controller cleaned up');
  }
}

module.exports = ScheduleController;
