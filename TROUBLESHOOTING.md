# Schedule System Troubleshooting Guide

## Error Fixes Applied

### 1. `cronParser.parseExpression is not a function`

**Problem**: Incorrect import of cron-parser library
**Fixed**: Changed `cronParser.parseExpression()` to `parser.parseExpression()`

```javascript
// Before (broken):
const cronParser = require('cron-parser');
const interval = cronParser.parseExpression(schedule);

// After (fixed):
const parser = require('cron-parser');
const interval = parser.parseExpression(schedule);
```

### 2. `Cannot read properties of undefined (reading 'cronExpression')`

**Problem**: Accessing properties on undefined job objects
**Fixed**: Added proper null checking and fallback to settings

```javascript
// Before (broken):
cronPattern: job ? job.options.cronExpression : null

// After (fixed):
const cronPattern = job ? (job.options?.cronExpression || zoneSettings?.schedule) : zoneSettings?.schedule;
```

### 3. Invalid cron expression: "0 10 */3 * *"

**Problem**: This appears to be corrupted data in settings
**Fixed**: Added schedule validation and reset functionality

## Emergency Recovery Commands

If the system has corrupted schedule data, use these solutions:

### Option 1: Reset via Web Interface
1. Go to `http://localhost:3000`
2. Click "Сбросить расписания" button
3. Confirm the reset

### Option 2: Reset via API
```bash
curl -X POST http://localhost:3000/api/reset-schedules
```

### Option 3: Manual Settings Reset
Delete the settings file to force regeneration:
```bash
rm /home/pi/watering/data/settings.json
# Restart the application
sudo systemctl restart auto-watering
```

### Option 4: Telegram Bot Reset
Use the Telegram bot to set valid schedules:
```
/setschedule 1 "0 8 * * *" 15
/setschedule 2 "0 18 * * *" 12  
/setschedule 3 "0 7,19 * * *" 10
/setschedule 4 "0 9 * * 1,3,5" 20
```

## Cron Expression Validation

The system now validates cron expressions with both libraries:
- `node-cron` for scheduling
- `cron-parser` for next execution time calculation

### Valid Cron Examples:
- `0 8 * * *` - Daily at 8:00 AM
- `0 7,19 * * *` - Daily at 7:00 AM and 7:00 PM  
- `0 9 * * 1,3,5` - Monday, Wednesday, Friday at 9:00 AM
- `0 */6 * * *` - Every 6 hours
- `30 20 * * 0` - Sundays at 8:30 PM

### Invalid Examples That Will Be Rejected:
- `0 10 */3 * *` - Missing day of week field
- `25 8 * * *` - Invalid hour (25)
- `* * * * * *` - Too many fields (6 instead of 5)

## Monitoring and Debugging

### Check System Status
```bash
# View recent logs
sudo journalctl -u auto-watering -f

# Check application status
sudo systemctl status auto-watering

# Restart if needed
sudo systemctl restart auto-watering
```

### Check Settings File
```bash
cat /home/pi/watering/data/settings.json
```

Expected structure:
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

### Telegram Bot Debugging
Test these commands:
- `/status` - Should show all zones with schedules
- `/schedule` - Should show readable schedule format
- `/help` - Should show updated command list

## Prevention

To prevent similar issues:

1. **Validate Input**: The system now validates all cron expressions before saving
2. **Backup Settings**: Consider backing up `/home/pi/watering/data/settings.json`
3. **Monitor Logs**: Check logs regularly for validation errors
4. **Use Standard Patterns**: Stick to common cron patterns when possible

## Recovery Steps Summary

If you encounter errors:

1. **Try Web Reset**: Use the "Сбросить расписания" button
2. **Check Logs**: Look for specific validation errors
3. **Manual Reset**: Delete settings.json if needed
4. **Restart Service**: `sudo systemctl restart auto-watering`
5. **Verify**: Check `/status` in Telegram or web interface

The system should now be much more robust against invalid cron expressions and handle errors gracefully.
