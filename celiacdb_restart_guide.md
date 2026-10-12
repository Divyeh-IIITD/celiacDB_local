````markdown
# 🔁 CeliacDB Website Restart Guide (for Server)

This guide helps you safely restart the **CeliacDB website** running on the server.

---

## ⚡ One-Command Quick Restart

```bash
cd /storage4tb-1/celiacDB && ./restart_celiacdb.sh
````

✅ This single command automatically:

* Closes any old screen sessions
* Starts a new one
* Activates the `celiacDB` Conda environment
* Launches the Node.js app
* Restarts Nginx
* Checks and displays its status

---

## 🧩 Manual Restart (If Needed)

If you prefer to restart manually, follow the detailed steps below.

---

## ⚙️ Manual Quick Restart Summary

```bash
screen -ls
screen -S celiacDB -X quit
screen -S celiacDB
conda activate celiacDB
npx node app.js
# Press Ctrl + A, then D to detach
sudo systemctl restart nginx
sudo systemctl status nginx
# To exit, simply press: q
```

---

## ✅ Step-by-Step Instructions

### 1. Navigate to the project directory

```bash
cd /storage4tb-1/celiacDB
```

---

### 2. Check if a screen session already exists

```bash
screen -ls
```

If you see a session named `celiacDB`, terminate it using:

```bash
screen -S celiacDB -X quit
```

This cleanly closes the old session.

---

### 3. Create a fresh new screen session

```bash
screen -S celiacDB
```

This opens a new screen session named `celiacDB`.

---

### 4. Activate the Conda environment

```bash
conda activate celiacDB
```

This ensures you’re using the correct environment before running the website. Before moving to the next step that you are note in the (base), and you are in the conda environment of (celiacDB) only, maybe if you run this command for the first time something gets installed, so please do run the "conda activate celiacDB" command once more until you are not in the conda environment of (celiacDB).

---

### 5. Start the website

```bash
npx node app.js
```

You’ll see logs showing that the server is running.

---

### 6. Detach the screen and leave it running

Press:

```
Ctrl + A, then D
```

This keeps the app running in the background.

---

### 7. Restart Nginx (to ensure proxy is active)

Once your Node app is confirmed running on port **3000**, restart Nginx to make the domain reflect the changes.

```bash
sudo systemctl restart nginx
sudo systemctl status nginx
```

✅ If it shows **active (running)** — the site is successfully live again.
To exit from the status view page, press:

```
q
```

---

## 🧠 Common Commands Summary

| Action                 | Command                        |
| ---------------------- | ------------------------------ |
| List screen sessions   | `screen -ls`                   |
| Terminate old screen   | `screen -S celiacDB -X quit`   |
| Create new screen      | `screen -S celiacDB`           |
| Activate environment   | `conda activate celiacDB`      |
| Start app              | `npx node app.js`              |
| Detach screen          | `Ctrl + A` then `D`            |
| Reattach screen        | `screen -r celiacDB`           |
| Exit screen completely | `Ctrl + D` or `exit`           |
| Restart Nginx          | `sudo systemctl restart nginx` |
| Check Nginx status     | `sudo systemctl status nginx`  |

---

⚠️ **If the app fails to start:**
Read the error message carefully and fix any issues before retrying.

---

**Author:** Divyansh
**Last Updated:** October 29, 2025

```
```
