from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5174/')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    # 截图初始状态
    page.screenshot(path='/tmp/xiranite_initial.png', full_page=True)

    # 检查 console errors
    errors = []
    page.on('console', lambda msg: errors.append(f"{msg.type}: {msg.text}") if msg.type == 'error' else None)
    page.wait_for_timeout(500)

    # 尝试切换语言到中文
    # 先找 settings 按钮（齿轮图标）
    buttons = page.locator('button').all()
    print(f"Found {len(buttons)} buttons")
    for i, btn in enumerate(buttons[:20]):
        txt = btn.inner_text()[:50]
        title = btn.get_attribute('title') or ''
        print(f"  btn[{i}]: text='{txt}' title='{title}'")

    browser.close()
    print("\nDone")
