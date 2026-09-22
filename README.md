# Jev Focus

**A calmer Instagram and YouTube feed, shaped around what you actually care about.**

Jev Focus is a Chrome extension that helps you spend less time scrolling past irrelevant videos. Tell it the topics you want to see—such as AI, startups, fitness, design, or finance—and it uses TypeSafe Jev to identify low-match content.

- On **Instagram Reels**, low-match Reels are skipped automatically.
- On **YouTube**, low-match video cards are hidden from supported feeds and search results.
- You stay in control: adjust the match threshold, pause filtering at any time, and keep favourite creators visible.

## Download

[**Download Jev Focus for Chrome**](../../releases/latest/download/jev-focus.zip)

This link always points to the newest published release. If you do not see a release yet, download the repository instead and follow the same installation steps below.

> Chrome does not install extension ZIP files with a single click. After downloading, unzip the file and load the extracted folder in Chrome. A one-click install will be available only through a future Chrome Web Store listing.

## Install in Chrome

1. Download and unzip `jev-focus.zip`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** in the top-right corner.
4. Select **Load unpacked**.
5. Choose the unzipped `jev-focus` folder—the folder containing `manifest.json`.
6. Pin **Jev Focus** from Chrome's extensions menu if you would like quick access to the on/off switch.

## Get started

1. Select the Jev Focus icon in Chrome and choose **Open settings**.
2. Add the topics you want more of. You can enter one topic per line or separate them with commas.
3. Add your TypeSafe Jev API key (it starts with `apikey_`).
4. Choose your match threshold:
   - **Lower threshold:** more variety in your feed.
   - **Higher threshold:** stricter filtering.
5. Select **Save settings**, then **Test connection**.
6. Refresh Instagram or YouTube.

## Where it works

| Platform | What Jev Focus does |
| --- | --- |
| Instagram Reels | Checks the Reel currently on screen and advances past low-match content. |
| YouTube Home | Hides low-match video cards as you browse. |
| YouTube search | Filters low-match videos from search results. |
| YouTube related and compact views | Filters supported video cards around videos and in compact layouts. |

On YouTube, the Jev Focus badge at the bottom-right tells you when it is checking videos and how many cards it has hidden. Select the badge to open settings.

## Make it yours

- **Topics to show:** your personal interests and learning goals.
- **Match threshold:** how closely a video must match before it stays visible.
- **Always-show creators and channels:** people you never want filtered out.
- **Focus mode:** pause or resume filtering without deleting your settings.

## How it decides

Jev Focus sends the information a page makes available—such as a title, caption, hashtags, creator, and accessibility text—to TypeSafe Jev for a relevance score. It does **not** watch, listen to, or transcribe the video itself.

A video stays visible when its score meets your chosen threshold. On Instagram, a low-match Reel is skipped. On YouTube, a low-match card is hidden. YouTube's count can grow while you scroll because more videos are loaded and checked.

## Privacy and API key safety

- Jev Focus connects only to TypeSafe's official API at `api.typesafe.ai`.
- Your API key is stored locally in Chrome and is not synced by the extension.
- Your topics, threshold, focus-mode choice, and always-show list are saved in Chrome's synced extension settings.
- Never post your API key, screenshots containing it, or browser-profile files online.

## Troubleshooting

**Nothing is being filtered**

1. Make sure Focus mode is on.
2. Open settings and run **Test connection**.
3. Refresh the Instagram or YouTube tab after saving changes.
4. In `chrome://extensions`, select **Reload** on Jev Focus, then refresh the site.

**A video you like was hidden**

Lower the match threshold or add that creator/channel to **Always-show creators and channels**.

**The extension stopped working after a website update**

Instagram and YouTube occasionally change their page layouts. Check this repository's releases for an update, then reload the extension and refresh the site.

## For contributors

Jev Focus has no build dependencies. After making a change, run:

```bash
./scripts/validate.sh
```

To create the release files:

```bash
./scripts/package.sh
```

Upload both generated files to a GitHub Release:

- `dist/jev-focus.zip` — the stable asset used by the download link above.
- `dist/jev-focus-v<version>.zip` — the versioned archive.

## License

No license is included yet. Add one before accepting public contributions or reuse so the project's permissions are clear.
