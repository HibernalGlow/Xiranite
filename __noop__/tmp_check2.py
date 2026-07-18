from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5174/')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    # 点击"打开模块库"按钮
    page.locator('button:has-text("打开模块库")').click()
    page.wait_for_timeout(800)

    # 截图模块库
    page.screenshot(path='/tmp/xiranite_registry.png', full_page=True)

    # 部署几个模块（点击 DEPLOY 按钮）
    deploy_btns = page.locator('button:has-text("部署")').all()
    print(f"Found {len(deploy_btns)} deploy buttons")
    for i in range(min(5, len(deploy_btns))):
        try:
            deploy_btns[i].click()
            page.wait_for_timeout(300)
        except:
            pass

    # 关闭模块库（按 ESC）
    page.keyboard.press('Escape')
    page.wait_for_timeout(500)

    # 截图部署后的卡片
    page.screenshot(path='/tmp/xiranite_deployed.png', full_page=True)

    # 打印页面上所有可见文本
    body_text = page.locator('body').inner_text()
    print("=== Page text (first 2000 chars) ===")
    print(body_text[:2000])

    browser.close()
