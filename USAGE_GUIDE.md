# THE FINALS Ranked Activity Tracker — Usage Guide

## Overview
A browser-based tool that monitors the official leaderboard API for point changes in real-time, estimating player status (Lobby, In Match, Offline, etc.). Use it to track cheaters, pros, or friends — and decide when to queue.

**URL:** https://thefinals-ranked-activity-tracker.yatoru19.workers.dev/

---

## 1. Adding Players & Starting Monitoring

Enter an Embark ID (e.g. `ytr#939`) in the **search bar** at the top and click **"Add"**.
- Supports Steam, PSN, and Xbox IDs
- Monitoring starts automatically as soon as a player is added
- You can bulk-add multiple players using commas or line breaks in the text area at the bottom

**Sharing via URL:** Add `?names=ytr%23939` to the URL to pre-load specific players. Share this link so others can monitor the same players.

---

## 2. Live Table

Displays real-time status for all monitored players.

| Column | Description |
|--------|-------------|
| **name** | Player name + region tag (AS/EU/NA) + category badge (Cheater/Notable/Pro) |
| **rank** | Leaderboard ranking |
| **points** | Current ranked score (RS) |
| **delta** | Point change since last poll |
| **changed** | Time when points last changed |
| **inferred state** | Estimated current status (see below) |
| **next_match%** | Probability of entering a match within the next 30 minutes |
| **last_poll** | Time of last API fetch |
| **error** | Error info + quick encounter buttons |

### Inferred States

| State | Meaning | Color |
|-------|---------|-------|
| **Lobby** | Post-match or queuing | Blue |
| **Reflect** | Points changed, waiting for API to update | — |
| **In Match** | Currently in a match (R1 or R2) | Orange |
| **Tournament Deep** | Likely advanced to R2 or Finals | Red |
| **Returning** | Match ended, returning to lobby | — |
| **Offline** | No activity for an extended period | Gray |
| **Not Found** | Not on the leaderboard | — |
| **Banned** | Ban detected | — |
| **Name Changed** | Name change detected | — |

---

## 3. Tab Switching (Above the Live Table)

- **My List**: Shows only players you've personally added
- **Global List**: Community-shared list of cheaters, notable players, and pros
- **Pickup**: Displays a combined match probability graph for starred players

---

## 4. Filters

- **Region Filter**: Filter by 🌐 All / AS / EU / NA
- **Name Search**: Real-time text filter by player name
- **State Filter**: Dropdown with checkboxes to filter by multiple states simultaneously (e.g. show only Lobby + In Match)

---

## 5. Expanded Row (Click a Player Name)

Clicking a player name expands the row to reveal:

- **Spark Graph**: 30-minute match probability displayed as bar chart
- **Point History Chart**: Line graph of recent point changes
- **Personal Memo**: Displayed next to the graphs. Private notes visible only to you
- **Server Selector**: Set AS/EU/NA (synced to Global List)

---

## 6. Global List (Bottom Section)

A community-shared player list for flagging cheaters, suspicious players, notable players, and pros.

**Browsing:** Filter by region tab. Each entry shows category, notes, and who added it.

**Adding a Player:**
1. Open "＋ Report/Add Cheater / Notable / Pro Player"
2. Enter the Embark ID
3. Select region (AS / EU / NA)
4. Select category (Cheater / Suspicious / Notable / Pro)
5. Enter a note (optional)
6. Click "Add"

**＋ My List**: One-click button to add any Global List player to your personal watchlist.

---

## 7. Quick Encounter Buttons

Located next to the error column in the Live Table. Record in-match encounters:
- **R1** (Round 1) / **R2** (Round 2) / **FR** (Finals)
- **Won** / **Final End** / **Offline**
- Records auto-expire after a set duration

---

## 8. Pickup (Star) Feature

Star players in the Live Table to track their combined match probability. Shows the chance that **at least one** of your starred players is in a match within the next 30 minutes, visualized as a bar graph.

---

## 9. Notifications

Toggle browser notifications with the 🔔 button in the top-right corner. Receive push notifications when a monitored player's state changes (e.g. enters a match).

---

## 10. Settings

### Basic Settings
- **Wait**: Queue wait time (default: 5 min)
- **Match**: Average match duration (default: 31 min)
- **Jitter**: Error tolerance margin

### Advanced Settings
- **Season**: S7 / S8 / S9 (set to current season)
- **Platform**: crossplay / steam / psn / xbox
- **Interval**: Polling interval (30s / 60s / 120s)
- **Reflect X**: API update delay after in-game point change (auto-detected)

### RS Drop Alert
Notifies you when a player's RS drops by more than a specified threshold in a single poll. Useful for detecting bans in real-time.

### Update Estimator
Automatically detects the leaderboard's batch update cycle (~48 min) and adjusts Reflect X accordingly. Accuracy improves after observing 3+ batch updates.

### Export
Download your data in CSV or JSONL format.

---

## 11. Accounts & Access Control

- **Login**: Log in as an authorized user to edit the Global List
- **Create Account**: Open Advanced Settings → Access Control → Enter admin password to open the admin panel and add users
- **Backend Sync**: Sync data with the Cloudflare Workers backend

---

## 12. State Change Log

All state transitions (e.g. Offline → Lobby, Lobby → In Match) are automatically recorded. View as a timeline or export as CSV.

---

## 13. Language Switching

Switch between **Japanese (日本語)**, **Korean (한국어)**, and **English** using the buttons in the top-right corner.

---

## 14. PWA Support

Use "Add to Home Screen" in your browser to install it as a mobile app. Previous data is cached and displayed even when offline.

---

## Typical Use Cases

### Avoid Cheaters
Check the Global List for known cheaters → Add to My List → When their status shows "Lobby", avoid queuing.

### Avoid or Match with Pros
Add pro players to your watchlist → When they're "In Match", queue up to avoid them — or wait until they're in "Lobby" to try matching with them.

### Check if Friends Are Playing
Add your friends' IDs and see in real-time whether they're in a match or available.

### Monitor Bans
Set up RS Drop Alerts to detect when a cheater gets banned (massive RS loss) in real-time.
