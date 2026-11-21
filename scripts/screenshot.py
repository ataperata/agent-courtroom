# Render the README screenshots. Needs: npm run build, then
#   pip install playwright && playwright install chromium
#   python3 scripts/screenshot.py [output-dir]
# Set CHROME_PATH to use an installed Chrome instead.
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "web")
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4178", "--bind", "127.0.0.1", "--directory", root], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        # Cross-examination in the checkout case, partway through a replay
        pg.goto("http://127.0.0.1:4178/?case=checkout-outage&view=replay&turn=22")
        pg.wait_for_selector(".turn")
        pg.wait_for_timeout(600)
        pg.evaluate("document.querySelectorAll('.turn').forEach(e=>e.style.animation='none')")
        pg.locator("#turn-17").scroll_into_view_if_needed()
        pg.evaluate("document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, document.getElementById('turn-13').getBoundingClientRect().top + window.scrollY - 110)")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f"{out}/viewer-trial.png")
        # Fastener case with the full record: jury room, then the top of the page
        pg.goto("http://127.0.0.1:4178/?case=fastener-lot-2417")
        pg.wait_for_selector(".jury-room")
        pg.wait_for_timeout(500)
        pg.evaluate("document.querySelectorAll('.turn,.juror').forEach(e=>e.style.animation='none')")
        pg.evaluate("document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, document.getElementById('phase-deliberation').getBoundingClientRect().top + window.scrollY - 100)")
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{out}/viewer-jury.png")
        pg.evaluate("window.scrollTo(0,0)")
        pg.wait_for_timeout(300)
        pg.screenshot(path=f"{out}/viewer-hero.png")
        print("errors:", errors)
        b.close()
finally:
    srv.terminate()
