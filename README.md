# #100Devs Asset Manager

A collection of various scripts and data structures that I use to manage #100Devs content.

> Why aren't the assets here?

The actual assets aren't *mine* to distribute, therefore I'm not distributing them, but instead the scripts to manage them.

## Asset Structure

Assets are grouped into directories above the one the script is located in, named the date of the stream, including both Office Hours & normal Classes.

- `YYYY-MM-DD`
  - `chat.json`
  - `*.mp4`
  - `links`
  - `markers`
  - `captions`
    - `*.vtt`
    - `*.txt`
- `100devs-asset-manager`
  - You are here

### Asset Types

Not all of these files exist for each stream, and the streams are differentiated by the day of the week they're listed as - Office Hours are only on Sunday, all other days are Classes.

#### Office Hours

Office Hours do not contain a `captions` directory,

#### Class

Classes do not contain a `*.mp4` video.

### `chat.json`

`chat.json` is a concatenated JSON containing all of the Twitch chat messages, straight from the Twitch API itself.

You can obtain this JSON however you wish, but [Twitch VOD Chat Downloader](https://github.com/RascalTwo/TwitchVODChatDownloader) is the only one guaranteed to work.

### `*.mp4`

This is the downloaded Office Hours video, downloaded as the Office Hours are not being archived on YouTube, therefore are no longer available 60 days after their broadcast date.

The command

```shell
yt-dlp -f 1080p60 https://twitch.tv/videos/VOD_ID
```

is used to download the video.

### `links`

`links` is a simple `:`-delimited mapping of Names to URLs.

At minimum every stream contains a `Twitch` and `Discord` URL.

Classes can additionally have `Tweet`, `Slides`, and `YouTube`.

In the rare occasion that a link would usually be expected for the stream yet is not available, leaving it blank is an option.

> YouTube links support the `?t=` parameter to include the offset between the start of the Twitch VOD and the start of the YouTube video.

### `markers`

`markers` is a two-column tab-delimited document containing the `D:H:M:S` of a marker, and the name of a marker.

These can be created manually, though [Twitch User Markers](https://github.com/RascalTwo/TwitchUserMarkers) is what's used to generated these, as it has an export in this exact format.

There are some marker keywords that hold significance:

- `#00`
  - The Slide of that number appearing on screen.
- `Question of the Day`
  - Question of the Day was asked
- `... X Started` / `... X Ended`
  - Mark the beginnings & endings of events, can be suffixed after contextual information
- `Raiding X`
  - The name of the Twitch streamer that was raided

### `captions`

This contains the captions from YouTube, first as generated by the

```shell
yt-dlp --write-auto-sub --sub-lang en --skip-download YOUTUBE_LINK
```

command, and then as generated by this [vtt-to-txt] Python script.

## Scripts

There are various scripts, some for querying, others for transforming existing content, and a few for validating existing data.

As this project is written in TypeScript, you'll need to first execute `npm run build` to generate the JS these scripts execute.

### `search`

Performs searching of almost _all_ assets:

- `markers`
- `links`
- `captions`
- `chat.json`

for keywords, showing the highlighted content along with a link to the video when the content appeared.

### `create`

Automates the creation of a new asset, asking for the date, Twitch link, and lastly the Discord link.

### `update`

Automates the updating of assets, from simply opening up the text files for manual updating, to automatically download additional assets.

### `validate`

Validates the assets for each stream, performing a number of checks on each stream:

- Expected assets exist
- `markers` contains no blank lines
- All events are in pairs and ordered correctly
- Slide marker text is actually on the Slide
- Chat is for this stream
- Chat is complete

### `relative-markers`

Converts an absolutely-written `markers` file to a relative one.

An absolutely-written `markers` is one that has a first line of the literal time the content started, and the conversion removes that much time from all of the following `D:H:M:S` timestamps.

### `generate-youtube-comment`

Generates the text of a YouTube comment from a chosen class `markers`, primarily by only a subset of all markers:

- Slide Markers
- Event Markers
- Question of the Day

Writes it to `youtube-comment` for easy copying.

### `generate-discord-messages`

Generates Discord messages of the chosen class `markers`, specifically surrounds the text in a XYZ, and ensures each message does not go over the message character limit.

Writes the comments to `discord-message.00` files.