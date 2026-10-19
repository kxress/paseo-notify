# Paseo Ear

A client-side Paseo plugin that plays `Music/Paseo.mp3` once locally when an agent turn completes or fails. Playback happens on the device running Paseo rather than on the daemon host or through the Windows toast sound setting.

## Why this plugin exists

On this setup, Paseo's agent completion notifications have produced no audible sound on either Windows or macOS. On Windows, the notification sound setting is enabled and permission is granted; Paseo reports that its test notification was handed to Windows, yet no sound is heard. The cause is unclear, so this plugin works around the missing completion sound by listening for completion events in the Paseo client and playing audio directly through Paseo's client audio API.

The MP3 is bundled into `shared/paseo.ts` as base64 because Paseo's client audio API accepts audio data rather than a filesystem path. Update that asset from `Music/Paseo.mp3` when the track changes.

## Install

Install the plugin into the Paseo daemon from a directory available to that daemon:

```powershell
npm install
npm run typecheck
paseo plugin install D:\repos\paseo-eh
```

Keep the Paseo client connected to that daemon. Client contributions run in each connected client.

## Check playback

In Paseo, press Ctrl+K and run **Test Paseo Ear sound**. This plays the track once, matching completion alerts.

## Events

The plugin subscribes to the live timeline stream for active agents, including background work. It plays the track for `turn_completed` and `turn_failed` events. Canceled turns do not play it. Paseo does not replay events missed while the client is disconnected or suspended.

## License

WTFPL version 2. See [LICENSE](./LICENSE).
