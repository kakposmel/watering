# Migration to Schedule-Based Watering System

This document outlines the major rewrite from moisture sensor-based automatic watering to a schedule-based system.

## Changes Made

### 1. Removed Components
- **LED Controller (`src/led.js`)** - Completely removed LED moisture indication
- **Old Scheduler (`src/scheduler.js`)** - Replaced moisture-based automatic scheduler
- **Moisture-based logic** - Removed automatic watering triggers based on sensor readings

### 2. New Components
- **Schedule Controller (`src/scheduleController.js`)** - New cron-based scheduling system
- **Enhanced Pump Controller** - Added support for custom duration per watering
- **Updated Storage** - Added schedule settings support
- **New Web Interface** - Complete redesign for schedule management

### 3. Core Logic Changes

#### Before (Moisture-Based)
- System checked moisture levels every 15 minutes
- Watering triggered when moisture was "dry" for 3 consecutive readings
- Daily watering limits and cooldown periods
- LED indicated moisture status

#### After (Schedule-Based)
- Each zone has its own cron schedule (e.g., "0 8 * * *" for daily 8 AM)
- Custom water duration per zone (in seconds)
- No daily limits or cooldown for scheduled watering
- Manual watering still has 5-minute cooldown

### 4. New Features

#### Zone Configuration
- **Schedule**: Cron expression for watering times
- **Water Duration**: Custom duration in seconds (1-300)
- **Schedule Enable/Disable**: Per-zone schedule control
- **Zone Enable/Disable**: Master zone control

#### Default Schedules
- Zone 1: Daily at 8:00 AM (15 seconds)
- Zone 2: Daily at 6:00 PM (12 seconds)  
- Zone 3: Daily at 7:00 AM and 7:00 PM (10 seconds)
- Zone 4: Monday/Wednesday/Friday at 9:00 AM (20 seconds)

#### Web Interface
- Real-time schedule display
- Next watering time countdown
- Schedule editing with validation
- Visual status indicators
- History of scheduled vs manual watering

#### Telegram Bot Commands
- `/status` - Show system status and schedules
- `/schedule` - Display all zone schedules
- `/setschedule <zone> <cron> <seconds>` - Set zone schedule
- `/water <zone>` - Manual watering (unchanged)
- `/toggle <zone>` - Enable/disable zone (unchanged)

### 5. API Changes

#### New Endpoints
- `POST /api/schedule/:zone` - Update zone schedule
- `POST /api/toggle-schedule/:zone` - Enable/disable zone schedule

#### Modified Endpoints
- `GET /api/status` - Now returns schedule information and next watering times

### 6. Configuration Updates

#### Storage Structure
```json
{
  "zones": [
    {
      "name": "Zone 1",
      "enabled": true,
      "scheduleEnabled": true,
      "schedule": "0 8 * * *",
      "waterDuration": 15
    }
  ]
}
```

#### Dependencies Added
- `cron-parser` - For accurate next execution time calculation

### 7. Migration Notes

#### Data Migration
- Existing zone names and enabled status preserved
- Old moisture-related settings removed
- Default schedules applied to all zones

#### Backward Compatibility
- Old moisture sensor code kept (for potential future use)
- Old API endpoints maintained where possible
- Zone naming and basic controls unchanged

### 8. Usage Examples

#### Cron Schedule Examples
- `0 8 * * *` - Every day at 8:00 AM
- `0 7,19 * * *` - Every day at 7:00 AM and 7:00 PM
- `0 9 * * 1,3,5` - Mondays, Wednesdays, Fridays at 9:00 AM
- `0 */6 * * *` - Every 6 hours
- `30 20 * * 0` - Sundays at 8:30 PM

#### Telegram Commands
```
/schedule - View all schedules
/setschedule 1 "0 8 * * *" 15 - Zone 1 daily at 8 AM for 15 seconds
/status - View system status
```

### 9. System Benefits

#### Advantages
- **Predictable watering** - Exact times known in advance
- **Flexible scheduling** - Different patterns per zone
- **No sensor dependencies** - Works regardless of sensor status
- **Easy automation** - Standard cron expressions
- **Better control** - Individual zone management

#### Considerations
- **No automatic adjustment** - Doesn't respond to soil conditions
- **Manual monitoring** - User responsible for schedule adjustments
- **Weather independence** - Schedules run regardless of weather

### 10. Future Enhancements

#### Potential Additions
- Weather integration to skip watering on rainy days
- Seasonal schedule adjustments
- Multiple schedules per zone
- Integration with moisture sensors for conditional watering
- Mobile app for schedule management

## Testing

To test the new system:

1. **Start the application**: `npm start`
2. **Access web interface**: `http://localhost:3000`
3. **Test schedule setting**: Edit a zone's schedule and duration
4. **Test manual watering**: Use the "Полить" button
5. **Test Telegram commands**: Use `/status` and `/schedule`
6. **Verify next watering times**: Check countdown displays

## Rollback

If rollback is needed:
```bash
git checkout HEAD~1 -- src/scheduler.js src/led.js
mv public/index.html public/index_schedule.html
mv public/index_old.html public/index.html
```

The old moisture-based system can be restored by reverting the main application changes and restoring the old UI.
