# -*- coding: utf-8 -*-
"""
ORENTI — Проверка онлайн администрации
- Подключается к уже запущенному Яндекс Браузеру (порт 9222)
- Работает в существующей вкладке ORIENTI (не создаёт новых окон)
- Отчёт выводится в окно приложения (Tkinter), без txt-файлов
"""

import os
import time
import subprocess
import urllib.request
import threading

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

from playwright.sync_api import (
    sync_playwright,
    TimeoutError as PlaywrightTimeoutError
)


# ============================================================
# НАСТРОЙКИ
# ============================================================

URL = "https://orenti.ru/admintime/"
PORT = 9222

YANDEX_PATH = os.path.expandvars(
    r"C:\Program Files (x86)\Yandex\YandexBrowser\Application\browser.exe"
)

PROFILE_DIR = os.path.abspath("yandex_automation_profile")


# ============================================================
# ЗАПУСК ЯНДЕКС БРАУЗЕРА (ТОЛЬКО ЕСЛИ НЕ ЗАПУЩЕН)
# ============================================================

def is_browser_running():
    """Проверяет, отвечает ли порт отладки."""
    try:
        urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/json/version",
            timeout=1
        )
        return True
    except Exception:
        return False


def start_yandex_if_needed(log=print):
    """Если браузер уже запущен с портом 9222 — не трогаем.
       Иначе запускаем новый с нужным флагом."""

    if is_browser_running():
        log("✓ Яндекс Браузер уже запущен с портом отладки.")
        return True

    if not os.path.exists(YANDEX_PATH):
        log(f"✗ Яндекс Браузер не найден: {YANDEX_PATH}")
        return False

    os.makedirs(PROFILE_DIR, exist_ok=True)

    command = [
        YANDEX_PATH,
        f"--remote-debugging-port={PORT}",
        "--remote-debugging-address=127.0.0.1",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
    ]

    subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    log("Запускаю Яндекс Браузер...")

    for _ in range(30):
        if is_browser_running():
            log("✓ Браузер запущен.")
            return True
        time.sleep(1)

    log("✗ Не удалось дождаться запуска браузера.")
    return False


# ============================================================
# ПАРСИНГ
# ============================================================

def get_card_7days(page, card_class):
    card = page.locator(f".admin-stats__card.{card_class}")
    card.wait_for(state="visible", timeout=10000)

    rows = card.locator(".admin-stats__card-row")

    for i in range(rows.count()):
        row = rows.nth(i)
        label = row.locator("span").inner_text().strip()
        if label == "7 дней":
            return row.locator("b").inner_text().strip()

    return "0"


def get_online_7days(page):
    cards = page.locator(".admin-stats__extra-card")

    for i in range(cards.count()):
        card = cards.nth(i)
        label = card.locator(".admin-stats__extra-label").inner_text().strip()
        if label == "Онлайн (7д)":
            return card.locator(".admin-stats__extra-value").inner_text().strip()

    return "0"


def get_admin_data(page):
    stats = page.locator("#adminStatsBody")
    stats.wait_for(state="visible", timeout=15000)

    nickname = page.locator(".admin-stats__header-name").inner_text().strip()
    online = get_online_7days(page)
    bans = get_card_7days(page, "admin-stats__card--ban")
    mutes = get_card_7days(page, "admin-stats__card--mute")
    gags = get_card_7days(page, "admin-stats__card--gag")

    return nickname, online, bans, mutes, gags


# ============================================================
# ПОИСК ОДНОГО АДМИНА
# ============================================================

def search_admin(page, steam64):
    search = page.locator("#admin_steamid")
    search.wait_for(state="visible", timeout=15000)

    search.fill("")
    search.fill(steam64)
    search.press("Enter")

    stats_button = page.locator(
        f'button.admin-stats-btn[data-admin-id="{steam64}"]'
    )

    try:
        stats_button.wait_for(state="visible", timeout=15000)
    except PlaywrightTimeoutError:
        raise Exception(f"Админ со Steam64 {steam64} не найден.")

    stats_button.click()

    data = get_admin_data(page)

    # Закрываем окно статистики
    try:
        page.locator('#adminStats .popup_modal_close').click(force=True)
    except Exception:
        try:
            page.evaluate("""
                () => {
                    const btn = document.querySelector('#adminStats .popup_modal_close');
                    if (btn) btn.click();
                }
            """)
        except Exception:
            pass

    page.wait_for_timeout(300)
    return data


def format_result(nickname, online, bans, mutes, gags):
    return (
        f"**{nickname}** - "
        f"**{online}** | "
        f"баны - {bans} | "
        f"муты - {mutes} | "
        f"гаги - {gags}."
    )


# ============================================================
# GUI
# ============================================================

class App:

    def __init__(self, root):
        self.root = root
        self.root.title("ORENTI — Проверка онлайн администрации")
        self.root.geometry("820x720")
        self.root.minsize(700, 600)

        self.page = None
        self.browser = None
        self.playwright = None
        self.stop_flag = False
        self.worker = None

        self._build_ui()

    # --------------------------------------------------------
    # UI
    # --------------------------------------------------------

    def _build_ui(self):

        # --- Заголовок ---
        header = tk.Label(
            self.root,
            text="ORENTI — Проверка онлайн администрации",
            font=("Segoe UI", 13, "bold"),
            bg="#0a0a0a", fg="#ff3b3b",
            pady=10
        )
        header.pack(fill="x")

        # --- Блок: список SteamID ---
        frame_top = tk.Frame(self.root, padx=12, pady=8)
        frame_top.pack(fill="both", expand=False)

        tk.Label(
            frame_top,
            text="SteamID64 (каждый с новой строки):",
            font=("Segoe UI", 10, "bold")
        ).pack(anchor="w")

        self.input_text = scrolledtext.ScrolledText(
            frame_top,
            height=10,
            font=("Consolas", 10),
            bg="#141414", fg="#ffffff",
            insertbackground="#ff3b3b",
            relief="flat", bd=0
        )
        self.input_text.pack(fill="both", expand=False, pady=(4, 0))

        # --- Кнопки ---
        frame_buttons = tk.Frame(self.root, padx=12, pady=8)
        frame_buttons.pack(fill="x")

        self.btn_start = tk.Button(
            frame_buttons, text="▶ Запустить",
            bg="#ff3b3b", fg="#fff",
            activebackground="#c92626", activeforeground="#fff",
            font=("Segoe UI", 10, "bold"),
            relief="flat", padx=16, pady=8,
            cursor="hand2",
            command=self.start_check
        )
        self.btn_start.pack(side="left", padx=(0, 6))

        self.btn_stop = tk.Button(
            frame_buttons, text="⏹ Стоп",
            bg="#333333", fg="#fff",
            activebackground="#555555", activeforeground="#fff",
            font=("Segoe UI", 10, "bold"),
            relief="flat", padx=16, pady=8,
            cursor="hand2",
            state="disabled",
            command=self.stop_check
        )
        self.btn_stop.pack(side="left", padx=(0, 6))

        self.btn_reset = tk.Button(
            frame_buttons, text="🗑 Сбросить",
            bg="#333333", fg="#fff",
            activebackground="#555555", activeforeground="#fff",
            font=("Segoe UI", 10, "bold"),
            relief="flat", padx=16, pady=8,
            cursor="hand2",
            command=self.reset_all
        )
        self.btn_reset.pack(side="left", padx=(0, 6))

        self.btn_copy = tk.Button(
            frame_buttons, text="📋 Копировать всё",
            bg="#333333", fg="#fff",
            activebackground="#555555", activeforeground="#fff",
            font=("Segoe UI", 10, "bold"),
            relief="flat", padx=16, pady=8,
            cursor="hand2",
            command=self.copy_all
        )
        self.btn_copy.pack(side="left")

        # --- Прогресс ---
        frame_progress = tk.Frame(self.root, padx=12, pady=4)
        frame_progress.pack(fill="x")

        self.progress_label = tk.Label(
            frame_progress,
            text="Готов к запуску",
            font=("Segoe UI", 9),
            anchor="w"
        )
        self.progress_label.pack(fill="x")

        self.progress = ttk.Progressbar(
            frame_progress,
            mode="determinate",
            length=100
        )
        self.progress.pack(fill="x", pady=(2, 0))

        # --- Результаты ---
        frame_bottom = tk.Frame(self.root, padx=12, pady=8)
        frame_bottom.pack(fill="both", expand=True)

        tk.Label(
            frame_bottom,
            text="Результат:",
            font=("Segoe UI", 10, "bold")
        ).pack(anchor="w")

        self.output_text = scrolledtext.ScrolledText(
            frame_bottom,
            height=14,
            font=("Consolas", 10),
            bg="#0a0a0a", fg="#ffffff",
            insertbackground="#ff3b3b",
            relief="flat", bd=0
        )
        self.output_text.pack(fill="both", expand=True, pady=(4, 0))

        # --- Статус ---
        self.status = tk.Label(
            self.root,
            text="Готов",
            anchor="w",
            font=("Segoe UI", 9),
            fg="#8a8a8a",
            padx=12, pady=6
        )
        self.status.pack(fill="x")

    # --------------------------------------------------------
    # ЛОГ
    # --------------------------------------------------------

    def log(self, text):
        self.status.config(text=text)
        self.root.update_idletasks()

    def append_result(self, text):
        self.output_text.insert("end", text + "\n")
        self.output_text.see("end")
        self.root.update_idletasks()

    # --------------------------------------------------------
    # ЗАПУСК
    # --------------------------------------------------------

    def start_check(self):
        if self.worker and self.worker.is_alive():
            return

        raw = self.input_text.get("1.0", "end").strip()
        if not raw:
            messagebox.showwarning("Пусто", "Вставь хотя бы один SteamID64.")
            return

        # Парсим список
        steamids = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            if not line.isdigit():
                messagebox.showerror(
                    "Ошибка",
                    f"Некорректный SteamID64: {line}\n"
                    f"Должны быть только цифры."
                )
                return
            steamids.append(line)

        if not steamids:
            messagebox.showwarning("Пусто", "Не найдено ни одного SteamID64.")
            return

        # Готовим UI
        self.output_text.delete("1.0", "end")
        self.stop_flag = False
        self.btn_start.config(state="disabled")
        self.btn_stop.config(state="normal")
        self.progress["value"] = 0
        self.progress["maximum"] = len(steamids)
        self.progress_label.config(text=f"0 / {len(steamids)}")

        # Запускаем в отдельном потоке, чтобы GUI не зависал
        self.worker = threading.Thread(
            target=self._run_check,
            args=(steamids,),
            daemon=True
        )
        self.worker.start()

    # --------------------------------------------------------
    # ОСТАНОВКА
    # --------------------------------------------------------

    def stop_check(self):
        self.stop_flag = True
        self.log("Останавливаю...")

    # --------------------------------------------------------
    # СБРОС
    # --------------------------------------------------------

    def reset_all(self):
        if self.worker and self.worker.is_alive():
            if not messagebox.askyesno(
                "Подтверждение",
                "Проверка ещё идёт. Точно сбросить?"
            ):
                return
            self.stop_flag = True

        self.input_text.delete("1.0", "end")
        self.output_text.delete("1.0", "end")
        self.progress["value"] = 0
        self.progress_label.config(text="Готов к запуску")
        self.log("Сброшено")
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")

    # --------------------------------------------------------
    # КОПИРОВАНИЕ
    # --------------------------------------------------------

    def copy_all(self):
        text = self.output_text.get("1.0", "end").strip()
        if not text:
            messagebox.showinfo("Пусто", "Результатов пока нет.")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.log("✓ Скопировано в буфер обмена")

    # --------------------------------------------------------
    # РАБОЧИЙ ПОТОК
    # --------------------------------------------------------

    def _run_check(self, steamids):
        try:
            self.log("Запускаю Яндекс Браузер...")
            if not start_yandex_if_needed(log=self.log):
                self._finish_with_error("Не удалось запустить браузер.")
                return

            self.log("Подключаюсь к браузеру...")
            self.playwright = sync_playwright().start()
            self.browser = self.playwright.chromium.connect_over_cdp(
                f"http://127.0.0.1:{PORT}"
            )

            context = self.browser.contexts[0]

            # Ищем вкладку ORIENTI
            page = None
            for p in context.pages:
                if "orenti.ru" in p.url:
                    page = p
                    break

            if page is None:
                self.log("Открываю ORIENTI...")
                page = context.new_page()
                page.goto(URL, wait_until="domcontentloaded", timeout=60000)

            # Ждём поле поиска
            page.locator("#admin_steamid").wait_for(
                state="visible", timeout=30000
            )
            self.page = page

            self.log("Готово. Начинаю обход...")

            # --- Обработка ---
            success_count = 0
            for idx, sid in enumerate(steamids, start=1):
                if self.stop_flag:
                    self.log(f"Остановлено на {idx-1} из {len(steamids)}")
                    break

                self.log(f"[{idx}/{len(steamids)}] Ищу {sid}...")

                try:
                    nickname, online, bans, mutes, gags = search_admin(page, sid)
                    result = format_result(nickname, online, bans, mutes, gags)
                    self.append_result(result)
                    success_count += 1
                except Exception as e:
                    # Просто пропускаем не найденных
                    self.append_result(f"— {sid}: не найден")
                    pass

                self.progress["value"] = idx
                self.progress_label.config(text=f"{idx} / {len(steamids)}")

            self.log(f"✓ Готово. Обработано: {success_count} из {len(steamids)}")

        except Exception as e:
            self._finish_with_error(str(e))
            return
        finally:
            self._cleanup()
            self.btn_start.config(state="normal")
            self.btn_stop.config(state="disabled")

    def _finish_with_error(self, msg):
        self.log(f"✗ Ошибка: {msg}")
        messagebox.showerror("Ошибка", msg)
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")

    def _cleanup(self):
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        try:
            if self.playwright:
                self.playwright.stop()
        except Exception:
            pass
        self.browser = None
        self.playwright = None
        self.page = None


# ============================================================
# ЗАПУСК
# ============================================================

def main():
    root = tk.Tk()
    app = App(root)
    root.mainloop()


if __name__ == "__main__":
    main()