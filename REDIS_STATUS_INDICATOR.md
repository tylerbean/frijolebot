# Redis Connection Status Indicator

## Overview

Added a dynamic, auto-updating Redis connection status indicator to the Admin UI that shows real-time connection state without requiring page refreshes.

## Changes Made

### 1. New API Endpoint: `/api/admin/redis-status`
**File:** `apps/control-panel/app/api/admin/redis-status/route.ts`

**Purpose:** Lightweight endpoint for polling Redis connection status

**Features:**
- Returns connection state without requiring manual test
- 2-second connection timeout (faster than test endpoint)
- Respects caching enabled/disabled state
- Returns structured JSON response:
  ```json
  {
    "connected": true,    // boolean - connection successful
    "enabled": true,      // boolean - caching feature enabled
    "reason": "disabled"  // string (optional) - reason when disabled
  }
  ```

**Behavior:**
- If caching disabled or no URL configured: `{ connected: false, enabled: false, reason: "disabled" }`
- If Redis reachable: `{ connected: true, enabled: true }`
- If Redis unreachable: `{ connected: false, enabled: true, error: "..." }`

---

### 2. Admin UI Updates
**File:** `apps/control-panel/app/admin/page.tsx`

#### New State Variables
```typescript
const [redisConnected, setRedisConnected] = useState<boolean | null>(null);
```

#### Auto-Polling Effect
```typescript
useEffect(() => {
  if (!s?.caching?.enabled) {
    setRedisConnected(null);
    return;
  }

  const checkRedisStatus = async () => {
    try {
      const res = await fetch('/api/admin/redis-status', { cache: 'no-store' }).then(r => r.json());
      setRedisConnected(res.connected === true);
    } catch {
      setRedisConnected(false);
    }
  };

  // Check immediately
  checkRedisStatus();

  // Then poll every 5 seconds
  const interval = setInterval(checkRedisStatus, 5000);

  return () => clearInterval(interval);
}, [s?.caching?.enabled, s?.caching?.redisUrl]);
```

**Polling Behavior:**
- Only polls when `caching.enabled === true`
- Polls every 5 seconds
- Checks immediately on enable/URL change
- Cleans up interval on unmount or when caching disabled

#### Visual LED Indicator
**Location:** Caching section, right side of button row

```tsx
{s.caching.enabled && redisConnected !== null && (
  <div className="flex items-center gap-2 ml-auto">
    <div
      className={`w-3 h-3 rounded-full ${redisConnected ? 'bg-green-500' : 'bg-red-500'} shadow-lg`}
      style={{
        boxShadow: redisConnected
          ? '0 0 8px rgba(34, 197, 94, 0.6), inset 0 0 4px rgba(255, 255, 255, 0.4)'
          : '0 0 8px rgba(239, 68, 68, 0.6), inset 0 0 4px rgba(255, 255, 255, 0.4)'
      }}
      title={redisConnected ? 'Redis connected' : 'Redis disconnected'}
    />
    <span className="text-xs text-gray-500">
      {redisConnected ? 'Connected' : 'Disconnected'}
    </span>
  </div>
)}
```

**Visual Design:**
- 🟢 **Green LED:** Redis connected
  - Green glow effect
  - Shows "Connected" label
- 🔴 **Red LED:** Redis disconnected
  - Red glow effect
  - Shows "Disconnected" label
- **Hidden when:**
  - Caching is disabled
  - Initial load before first status check

**Position:**
- Right side of button row using `ml-auto`
- After "Test Redis", "Save", and test result text
- Aligns to the right edge of the section

---

### 3. Integration with Existing Functions

#### `saveCaching()` Function
**Updated to:**
- Clear status indicator when caching disabled
- Trigger immediate status check after save
- Update indicator immediately after configuration change

```typescript
if (!s.caching.redisUrl || s.caching.redisUrl.trim() === '') {
  setRedisTest('');
  setRedisConnected(null);
} else {
  // ... test logic ...
  // Trigger immediate status check
  const statusRes = await fetch('/api/admin/redis-status', { cache: 'no-store' }).then(r => r.json());
  setRedisConnected(statusRes.connected === true);
}
```

#### `testRedis()` Function
**Updated to:**
- Trigger immediate status check after manual test
- Update indicator to reflect current state
- Set to `false` on test failure

```typescript
// Trigger immediate status check
const statusRes = await fetch('/api/admin/redis-status', { cache: 'no-store' }).then(r => r.json());
setRedisConnected(statusRes.connected === true);
```

---

## User Experience

### Scenario 1: Enabling Redis
1. User navigates to `/admin`
2. User enters Redis URL
3. User toggles "Enabled" switch to ON
4. **Immediate:** Status check runs, LED appears
5. **Every 5s:** Status updates automatically

### Scenario 2: Connection Loss
1. Redis is connected (green LED visible)
2. Redis server goes down or network issue occurs
3. **Within 5s:** LED turns red, label changes to "Disconnected"
4. No page refresh needed

### Scenario 3: Connection Recovery
1. Redis is disconnected (red LED visible)
2. Redis server comes back online
3. **Within 5s:** LED turns green, label changes to "Connected"
4. No page refresh needed

### Scenario 4: Disabling Redis
1. User toggles "Enabled" switch to OFF
2. **Immediate:** LED disappears
3. Polling stops (no unnecessary requests)

### Scenario 5: Testing Connection
1. User clicks "Test Redis"
2. Test runs and shows result text
3. **Immediate:** LED updates to reflect test result
4. Continues polling every 5s

---

## Performance Considerations

### Polling Frequency
- **5 seconds** chosen as balance between:
  - Responsiveness (quick detection of issues)
  - Server load (reasonable request rate)
  - Network overhead (minimal)

### Request Optimization
- Uses `cache: 'no-store'` to bypass Next.js cache
- 2-second timeout on Redis connection attempt
- Lightweight response (< 100 bytes JSON)
- Only polls when feature enabled

### Resource Cleanup
- Interval cleared when component unmounts
- Interval cleared when caching disabled
- Interval recreated when URL changes

---

## Technical Details

### API Endpoint Security
- No authentication required (admin UI already protected)
- Only tests server-configured Redis URL (from database)
- Cannot test arbitrary URLs (uses database settings)
- Timeout prevents long-running connections

### Error Handling
- Gracefully handles Redis connection failures
- Suppresses error logging for status checks (not test)
- Falls back to `connected: false` on any error
- UI handles `null` state (before first check)

### State Management
- `null` = Status unknown (before first check or when disabled)
- `true` = Connected
- `false` = Disconnected

### Browser Compatibility
- Uses standard `fetch` API (widely supported)
- Uses `setInterval` (universal support)
- CSS shadow effects (graceful degradation)

---

## Testing

### Manual Testing
1. **Test connection appears:**
   - Enable caching
   - Add Redis URL
   - Save
   - Verify LED appears within 5s

2. **Test connection recovery:**
   - Stop Redis: `docker compose stop redis`
   - Wait 5s, verify LED turns red
   - Start Redis: `docker compose start redis`
   - Wait 5s, verify LED turns green

3. **Test disable behavior:**
   - Toggle caching off
   - Verify LED disappears immediately
   - Verify polling stops (check network tab)

4. **Test invalid URL:**
   - Enter invalid Redis URL
   - Save
   - Verify LED shows red/disconnected

5. **Test page navigation:**
   - Navigate to `/admin`
   - Verify LED appears (if enabled)
   - Navigate away
   - Verify polling stops (cleanup)

### API Testing
```bash
# Test status endpoint
curl http://localhost:3100/api/admin/redis-status

# Expected responses:

# When disabled:
{"connected":false,"enabled":false,"reason":"disabled"}

# When connected:
{"connected":true,"enabled":true}

# When disconnected:
{"connected":false,"enabled":true,"error":"connection_failed"}
```

---

## Future Enhancements

### Possible Improvements
1. **Websocket connection** for real-time updates (eliminates polling)
2. **Connection history** showing last N connection events
3. **Latency indicator** showing Redis response time
4. **Alert on disconnect** (browser notification)
5. **Reconnect attempts counter** showing stability metrics

### Configuration Options
Could add admin settings for:
- Polling interval (currently hardcoded to 5s)
- Show/hide status indicator
- Connection timeout threshold

---

## Summary

The Redis connection status indicator provides:

✅ **Real-time monitoring** without page refreshes
✅ **Visual feedback** with LED-style indicator
✅ **Conditional visibility** (only when Redis enabled)
✅ **Automatic updates** every 5 seconds
✅ **Graceful degradation** (falls back to in-memory cache)
✅ **No health check impact** (Redis failures don't affect bot health)

This feature improves operational visibility while maintaining the principle that Redis is a non-critical dependency.
