# Logs

**Controller → Logs** is one table of your DataFlash logs: the logs on the vehicle, the copies on this computer, and the copies in your account's cloud. Each flight is one row. The **Where** marks show where the log is: board (amber), this computer (cyan), cloud (indigo). A lit mark means the log is there.

Each row shows the date, the time the vehicle was armed and the number of flights, **Flags** (crash check, errors, failsafes, low battery, vibration clipping), **Changes** (parameters and firmware that changed since the previous log from the same board), your note, and the size. Hold the pointer on Flags or Changes to see the details. Armed time, Flags and Changes come from the copy on this computer, so a log that is only on the board shows them after you download it.

**Download** copies a log to this computer. **Download all** puts every log that is not on this computer in a queue; one log downloads at a time. **Show** opens the folder with the file. The [assistant](assistant.md) can measure a saved log: open the row's **⋯** menu and pick **Ask the assistant about this log**. The measurement describes the file. It is not a tuning recipe.

**★** stars a log, and the note cell keeps a short note. Click the note cell to edit it. Stars and notes are kept in the local catalog by the contents of the file, so they stay when the file moves. Starring a log that is only on the board downloads it first.

**This controller** is the board on the link, or the last board seen when there is no link. **All controllers** is every board this app has saved a log for. Search finds a log number, a note, a frame or a firmware. Click a column name to sort.

Messages appear in the bar above the table, on one line. The table does not move.

## Share

**Share…** writes an anonymised copy of the selected logs as one `.zip` in your Downloads folder. It can move every position so that home is at 0° N 0° E (distances and heights stay), move the date to the first week of 2000, remove the board serial, and clear the status lines. Parameters stay. The original files are not changed.

## Delete and clean up

**Delete…** moves files on this computer to the Recycle Bin. A copy in the cloud is deleted only when you select **From the cloud**. **⋯ → Clean up…** finds logs to delete by age, never armed, armed for a short time, unreadable header, or duplicate. Starred logs are kept unless you include them. The list and the total show before anything is deleted.

**⋯ → Erase board…** clears the logs on the vehicle. It waits until the vehicle says that the erase finished. Your copies and the parameters are not changed. The vehicle must be disarmed.

## Download new logs on connect

**⋯ → Download new logs on connect** is set for each controller. When the board connects, the app downloads the logs that are newer than the last log it saw. This also works when another tab is open.

## Cloud

When you sign in, stars and notes sync to your account. **⋯ → Cloud…** sets which log files upload: **Off**, **Starred only**, or **Every downloaded log**. Uploading is off until you select an option. Files are compressed. The storage of your plan is: free 100 MB, start 500 MB, plus 2 GB. When the storage is full, uploads stop and nothing is deleted.

A log that is only in the cloud shows **Download** on another computer. The assistant can read such a log; it downloads the log the first time a tool reads it. **Remove from the cloud…** deletes the cloud copy for all devices; the copy on this computer stays.

The cloud keeps the original log, with the position, the date and the board serial. Only you can read it. Use **Share…** to give a log to another person.

## Telemetry log

**Options → Telemetry log** records the live MAVLink stream as a Mission Planner `.tlog` while the link is up. You pick the folder. This is a recording of the link. The assistant does not treat it as a DataFlash file.
