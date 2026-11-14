# Profit Monitor on Unraid (Docker)

This runs Profit Monitor as a container on your Unraid server. Your tabs,
transactions and trades are then stored **on the server**, in one file in your
appdata share, instead of in the browser. Every device that opens the app
(PC, laptop, phone) sees the same data.

```
/mnt/user/appdata/profit-monitor/
├── profit-monitor.json          ← all your data (tabs, transactions, trades, set names, card image choices)
├── images/                      ← photos you added to transactions
└── backups/
    ├── profit-monitor-2026-11-15.json
    └── …                        ← one backup per day you made changes, the last 30 are kept
```

Total time: about 15 minutes, once.

---

## Step 1 – Let GitHub build the image (one time)

The repository contains a GitHub Actions workflow (`.github/workflows/docker.yml`)
that builds the Docker image and publishes it to the GitHub Container Registry
as `ghcr.io/brammeketv/profit-monitor-pkmn:latest`. It runs on every push to
`main`, so merging the pull request that added this file starts the first build.

1. Open <https://github.com/brammeketv/profit-monitor-pkmn/actions>.
2. Wait until **Build Docker image** shows a green check (about 3–5 minutes).
   - If it never started: click **Build Docker image** in the left list →
     **Run workflow** → **Run workflow**.
3. Make the image public, so Unraid can download it without logging in:
   1. Go to <https://github.com/brammeketv?tab=packages> and click
      **profit-monitor-pkmn**.
   2. On the right, click **Package settings**.
   3. Scroll to **Danger Zone** → **Change visibility** → choose **Public**,
      type the package name to confirm, and click **I understand…**.

   (The image only contains the app code, never your data. Your data stays on
   your server.)

## Step 2 – Export your current data

Your current data lives in the browser on the GitHub Pages site. A browser keeps
data per web address, so the new address on your server cannot see it
automatically. Move it over with an export:

1. Open the app where you use it now: <https://brammeketv.github.io/profit-monitor-pkmn/>
2. In the right sidebar, click **JSON exporteren**.
3. Keep the downloaded `profit-monitor-export….json` file at hand for step 5.

Do this on the device and browser that has your most recent data.

## Step 3 – Install the container on Unraid

You can use the ready-made template (easiest), or fill in the fields by hand.

### Option A – With the template

1. In the Unraid web interface, click the **terminal icon** (`>_`) at the top right.
2. Paste this line and press Enter:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/my-profit-monitor.xml https://raw.githubusercontent.com/brammeketv/profit-monitor-pkmn/main/unraid/profit-monitor.xml
   ```

3. Close the terminal. Go to the **Docker** tab → **Add Container** (at the bottom).
4. In the **Template** dropdown at the top, under **User templates**, pick
   **profit-monitor**.
5. Check the two fields shown:
   - **WebUI port**: `8080`. If another container already uses 8080, change it
     to a free port, e.g. `8085`.
   - **Data folder**: `/mnt/user/appdata/profit-monitor` (leave as is).
6. Click **Apply**. Unraid downloads the image and starts the container.

### Option B – By hand

**Docker** tab → **Add Container**, then fill in:

| Field | Value |
|---|---|
| Name | `profit-monitor` |
| Repository | `ghcr.io/brammeketv/profit-monitor-pkmn:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]/` |

Then click **Add another Path, Port, Variable, Label or Device** for each row below:

| Config Type | Name | Container value | Host value |
|---|---|---|---|
| Port | WebUI port | `8080` | `8080` (or another free port) |
| Path | Data folder | `/data` | `/mnt/user/appdata/profit-monitor` |
| Variable | Timezone | key `TZ` | `Europe/Amsterdam` |

Click **Apply**.

The defaults `PUID=99` and `PGID=100` make the files belong to `nobody:users`,
like other Unraid containers. You don't need to set them.

## Step 4 – Open the app

- In the **Docker** tab, click the Profit Monitor icon → **WebUI**, or
- go to `http://YOUR-UNRAID-IP:8080` (for example `http://192.168.1.10:8080`,
  or `http://tower.local:8080`).

At the bottom of the right sidebar it should now say
**“Data staat op de server”**. If it says *“Data wordt lokaal opgeslagen in uw
browser”*, the page is not talking to the container. See *Troubleshooting*.

## Step 5 – Import your data

1. In the app on your server, right sidebar → **.xlsm / .xlsx / .json importeren**.
2. Pick the JSON file from step 2.
3. Confirm *“Huidige workspace vervangen door deze JSON-back-up?”* with **OK**.
4. All your tabs, archived tabs, transactions, trades and set names are restored.

Check that everything is there. From now on, use the server address on every
device. Bookmark it, and on your phone use *Add to home screen*.

You can keep using the GitHub Pages site, but it keeps its own, separate data
in that browser. It does not sync with your server.

---

## Day-to-day

### Using it from several devices
Every change is saved to the server right away. When you switch back to the
app (another browser tab, or you unlock your phone), it picks up changes made
elsewhere.

If two devices change something at almost the same moment, the second one gets
a yellow bar:

- **Server-versie laden**: drop the change on this device and load what the
  other device saved.
- **Mijn versie bewaren**: overwrite the server with what this device shows.

A red bar means the server cannot be reached. The app keeps retrying every
5 seconds. Don't close the page until the bar is gone.

### Backups
- The container keeps a copy of the previous version once per day you make
  changes, in `/mnt/user/appdata/profit-monitor/backups/`. It keeps the last
  30; change this with the `BACKUP_KEEP` variable.
- The **Appdata Backup** plugin (Community Applications) also picks up this
  folder if you use it.
- **JSON exporteren** in the app still works for an extra manual backup.
  It contains all data, but not the photo files themselves. Those are in the
  `images` folder, which the Appdata Backup plugin includes.
- Photos you remove from a transaction are deleted from `images` after a day.

### Restoring a backup
1. **Docker** tab → Profit Monitor → **Stop**.
2. In the share `appdata/profit-monitor` (over the network or in the terminal),
   copy the backup you want over the current file:

   ```sh
   cp /mnt/user/appdata/profit-monitor/backups/profit-monitor-2026-11-15.json \
      /mnt/user/appdata/profit-monitor/profit-monitor.json
   ```

3. **Start** the container and reload the app in your browser.

(Alternative without the terminal: open the backup file in the app with
**.json importeren**.)

### Updating
When new changes are merged into `main`, GitHub builds a new image. On Unraid:
**Docker** tab → **Check for updates** → **apply update** next to Profit
Monitor. Your data folder is not touched by updates.

---

## Optional settings

All of these are under **Show more settings…** in the container template.

| Variable | Default | What it does |
|---|---|---|
| `AUTH_USER` / `AUTH_PASSWORD` | empty | When both are set, the browser asks for this login before opening the app. Useful if others use your network. |
| `BACKUP_KEEP` | `30` | Number of daily backups kept. |
| `TZ` | `Europe/Amsterdam` | Timezone for backup file names. |
| `PUID` / `PGID` | `99` / `100` | Owner of the data files. |

**Access from outside your home:** don't forward the port on your router. Use
Unraid's built-in **WireGuard VPN** (Settings → VPN Manager) or **Tailscale**
(Community Applications), and open the same `http://UNRAID-IP:8080` address
through the VPN.

---

## Troubleshooting

**The sidebar says “Data wordt lokaal opgeslagen in uw browser”.**
You opened the GitHub Pages site or a saved HTML file, not the container. Use
`http://YOUR-UNRAID-IP:8080`.

**Unraid says the image can't be pulled (`denied` / `unauthorized`).**
The package is still private. Do step 1.3 again, then click **Apply** in the
container again.

**The container stops right after starting.**
Docker tab → Profit Monitor icon → **Logs**. Common causes:
- *“EADDRINUSE”*: the port is taken. Edit the container and pick another WebUI port.
- *“EACCES” / permission denied*: the data folder can't be written. Run
  `chown -R 99:100 /mnt/user/appdata/profit-monitor` in the terminal and start again.

**I want to check the data file.**
`/mnt/user/appdata/profit-monitor/profit-monitor.json` is plain JSON. Read it
with any text editor, but stop the container before you change it by hand.

**Building the image yourself (without GitHub Packages).**
In the Unraid terminal:

```sh
docker build -t profit-monitor https://github.com/brammeketv/profit-monitor-pkmn.git#main
```

Then use `profit-monitor` as the **Repository** in step 3. Unraid can't
check for updates for a local image. Run the command again to update, then
restart the container.

## Running it without Unraid

Any machine with Docker:

```sh
docker compose up -d        # uses docker-compose.yml in this repository
```

Or without Docker, with Node 20 or newer:

```sh
DATA_DIR=./data-store node server.mjs   # then open http://localhost:8080
```
