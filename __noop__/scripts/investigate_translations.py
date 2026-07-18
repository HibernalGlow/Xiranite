from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--enable-logging"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    all_logs = []
    page.on("console", lambda msg: all_logs.append(f"{msg.type}@{msg.location['url']}:{msg.location['lineNumber']}: {msg.text}"))

    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)

    # Try to trigger BlockNote module: find a card that contains BlockNote and activate it
    # First just wait and capture any console output
    page.wait_for_timeout(5000)

    print("=== All console logs ===")
    for log in all_logs:
        if "missing" in log.lower() or "translation" in log.lower() or "i18n" in log.lower() or "blocknote" in log.lower():
            print(f"  [MATCH] {log}")
        else:
            print(f"  {log[:200]}")

    print(f"\n=== Total logs: {len(all_logs)} ===")

    # Take screenshot to see what's on screen
    page.screenshot(path="/tmp/translations_01.png", full_page=True)

    browser.close()
