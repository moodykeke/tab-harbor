# Privacy Policy — Tab Harbor · 标签港湾

**Last updated: 2026-09-26**

Tab Harbor is a local-first tab manager. It saves the tab groups, workspaces and work
history you explicitly choose to keep, so you can restore them later.

## What data we handle

Tab Harbor handles only the data you explicitly ask it to save:

- **Tab URLs and page titles** of the windows or groups you save, together with the time
  you saved them.
- **Your own organisation of that data**: group names, workspace names, pinned/archived
  flags, sort order, theme.
- **Backup settings you type in**: your WebDAV server address, username, and password
  (only if you choose to configure cloud backup).

Tab Harbor does **not** read page contents and does not inject scripts into web pages by
default. It has no content scripts.

**Optional session observation (off by default, opt-in).** If — and only if — you turn on
"Observation" in settings, Tab Harbor additionally records the **addresses and titles** of
pages you open or focus, to count visits and dwell time and fold them into your work records
at clock-out. It never records page contents, keystrokes, or scrolling. This buffer lives
only in the browser's session storage: it survives service-worker restarts but is **erased
when the browser closes**, and is cleared after each clock-out fold. A one-click "Clear
observation buffer" control is always available in settings. Turning the feature off stops
all recording immediately and leaves no trace.

## How data is stored

All of the above is stored **on your own device**, in the browser's extension storage
(`chrome.storage.local`). There is no Tab Harbor account and no Tab Harbor server.

## Network transmission

Tab Harbor makes **no network requests by default**. The only outbound connection it can
ever make is the optional cloud backup:

- It happens **only if you configure a WebDAV server yourself** and trigger a backup
  (manually, or automatically if you enable the daily upload).
- The destination is **the server you entered** — your own Nextcloud, Synology, Jianguoyun
  or similar. Tab Harbor has no server of its own and never sends your data to us or to any
  third party.
- The uploaded copy has your **WebDAV password removed** before it is sent.
- Your WebDAV password is stored **in plain text** in your local extension storage. It never
  leaves your device, but please avoid using Tab Harbor on a browser profile you share with
  others.

Tab Harbor contains no analytics, no telemetry, no advertising SDKs and no remotely hosted
code. Everything it runs ships inside the extension package.

## Data sharing

We do not collect your data, so we cannot and do not share it with anyone. No third-party
services are used.

## Data retention and deletion

Your data stays on your device until you delete it. You can:

- Delete individual groups, workspaces, records or tags in the manager page.
- Use **Settings → Clear all groups** to remove saved groups.
- Remove everything at once by uninstalling the extension — Chrome deletes its local storage
  on uninstall.

Automatic backups kept inside the extension are capped (crash snapshots: 3; local full
backups: 7) and rotate out on their own.

## Changes to this policy

If this policy changes, the updated version will be published at this URL and the date at
the top will be revised. Material changes affecting what data leaves your device will also
be noted in the extension's release notes.

## Contact

Questions about privacy: **moodykeke@gmail.com**

---

<!--
上传到 Chrome Web Store 前必做:
1. 把本文件发布到一个公开可访问的 URL(GitHub Pages / Gist raw / 自建站点均可),例如
   https://<你的账号>.github.io/<仓库>/PRIVACY.md
2. 把该 URL 填入 CHROMEWEBSTORE.md 的「Privacy Policy URL」以及开发者后台的隐私政策字段
3. 亲自访问一次该链接,确认不是 404(审查清单明确要求;死链会被自动拒绝)
4. 本文件不得打进商店 zip(pack.js 的白名单已排除根目录 .md)
-->
