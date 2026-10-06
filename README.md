<p align="right">
  <a href="README.md"><img alt="繁體中文" src="https://img.shields.io/badge/%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-0969da?style=for-the-badge"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-6e7781?style=for-the-badge"></a>
</p>

# Crazyhouse Review

## 目的
專為 Crazyhouse 對局設計的互動式復盤棋盤：載入 PGN 或 FEN、逐步瀏覽對局、下自己的變化，
並同時看到 Fairy-Stockfish 分析與說明——一個完全由 engine 與規則計算出的事實面板，以及
LLM 的自然語言回答；LLM 拿到的正是你眼前的局面、手中棋子（pocket）、變化與 engine 結果。
本專案不是對弈網站、題庫訓練、積分系統，也不是多變體平台。

## 架構
- `backend/` — FastAPI + python-chess。`app/chess_core.py` 是唯一的 Crazyhouse 規則實作；
  每個局面都是一條著法序列（`root_fen` + UCI 著法），以 `position_id` 識別。
- `frontend/` — React + TypeScript + Vite + Chessground。只顯示 backend 算出的局面，
  前端本身沒有任何棋規。

## 安裝
需求：Python ≥ 3.13 與 [uv](https://docs.astral.sh/uv/)、Node ≥ 22、Linux x86-64。

```bash
cd backend && uv sync
cd ../frontend && npm install
cd .. && ./scripts/fetch_engine.sh   # Fairy-Stockfish 14 + crazyhouse NNUE into engines/
```

## Engine 設定
Crazyhouse 分析使用 [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)
（一般的 Stockfish 不支援 crazyhouse），搭配 https://fairy-stockfish.github.io/nnue/ 的
crazyhouse NNUE 網路（下載腳本會驗證 checksum；把 `ENGINE_EVAL_FILE=` 設為空字串則改用傳統
評估）。Server 預設值由環境變數設定：`ENGINE_PATH`（預設 `engines/fairy-stockfish`）、
`ENGINE_THREADS`（4）、`ENGINE_HASH_MB`（256）、`ENGINE_MOVETIME_MS`（1500）、
`ENGINE_MULTIPV`（3）；這些值用於單純的 `/api/analyze` 端點、沒有畫面上分析結果時的解釋，
以及整局分析。所有評估都以白方視角表示（`evaluation` 單位為兵，白方能將死時 `mate` 為正）。

棋盤本身的分析使用觀看者自己的設定（Engine 面板的 ⚙，存在瀏覽器中）：

| 設定 | 選項 | 預設 |
|---|---|---|
| 線數（MultiPV） | 1–5 | 3 |
| 深度上限 | 不限、15、20、25、30、40 | 不限 |
| 每個局面計算時間 | 1、3、5、10、30、60 秒、無限 | 3 秒 |
| CPU 執行緒 | 1 –（CPU 數 − 1） | 4 |
| 記憶體（Hash） | 64 MB – 4 GB | 256 MB |

搜尋在任一上限先到時停止；「無限」會一直算到深度上限、按下停止、換局面，或 server 的
10 分鐘保護上限。結果會隨搜尋加深即時串流顯示（`POST /api/analyze/stream`，server-sent
`snapshot` 事件，最後是 `done`；`POST /api/analyze/stop` 可提早結束並保留結果）。有時間上限
且已完成的搜尋會依局面與設定快取；無限分析不快取，所以回到某個局面時會繼續往下算。
Threads 與 Hash 在每次搜尋前套用到 engine，因此每次搜尋都使用發起者的設定。事實面板與
LLM 會收到畫面上那份結果的 `analysis_id`，並使用完全相同的結果（不重新搜尋）；它們額外需要的
搜尋（候選著、空著威脅）在第二個 engine process 上執行，所以提問永遠不會打斷長時間分析。

## 執行
單一 process（建置 UI、同時提供 UI 與 API，缺少 engine 時自動下載）：
```bash
./scripts/serve.sh        # → http://127.0.0.1:8820  (PORT=... to change)
```

開發模式（hot reload）：
```bash
# terminal 1
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820
# terminal 2
cd frontend && npx vite --host 127.0.0.1 --port 5180
```
開啟 http://127.0.0.1:5180。

## 區網存取（開機自動啟動）
以開機自動啟動的 systemd user service 將 app 提供給區域網路：
```bash
./scripts/install_service.sh          # LAN_NETWORK=192.168.0.0/24 PORT=8820 by default; re-run after updates
sudo ufw allow from 192.168.0.0/24 to any port 8820 proto tcp comment 'crazyhouse-review'   # once
```
之後開啟 `http://<本機的區網 IP>:8820`（腳本會印出網址；IP 由 DHCP 分配，可能會變）。
Service 監聽所有網路介面，但 app 只回應 `ALLOWED_CLIENT_NETWORKS` 內的連線（loopback 與區網）；
其他來源（例如 Tailscale 或 Docker）一律回 403。區網內每個人都能使用 AI 功能，消耗的是這台
機器的 agy 額度。管理指令：`systemctl --user status|restart|stop crazyhouse-review`，
日誌：`journalctl --user -u crazyhouse-review`。

## 測試
```bash
cd backend && uv run pytest -q
cd frontend && npx vitest run && npx tsc -b && npx playwright test
```

## LLM 設定
自然語言解釋來自以下兩種 provider 之一（`LLM_PROVIDER=auto` 會選第一個可用的；見
`.env.example`）：
- **Claude**：`.env`（已 git-ignore）中設定 `ANTHROPIC_API_KEY` 時，透過官方 Anthropic SDK 呼叫
  `claude-opus-5-5`，effort `medium`，並啟用 server 端拒答 fallback（`fallbacks="default"`）。
- **本機 `agy` CLI**：沒有 key 時使用（用它自己的登入與訂閱額度）：
  `gemini-3.8-flash-high`，每個問題以 headless 方式在空的私有目錄中執行，plan mode、
  終端機 sandbox，並在提示中要求不使用工具。回答約需 30–60 秒（畫面會顯示計時）。

兩者都沒有時，其他功能照常運作，AI 按鈕會顯示尚未設定 LLM。
`LLM_PROVIDER=fake` 是只給自動化測試用的確定性替身。

每個回答都會再檢查：回答中提到、但目前既不合法、也不在提供給它的 engine／對局資料中的著法，
會標示為「未驗證」。設定好 key 後可用以下指令檢查真實回答：
```bash
cd backend && SHOW_ANSWERS=1 uv run python scripts/llm_smoke.py   # a few requests, uses credits
```

## 目前功能
- Crazyhouse 局面狀態（含 pocket 與升變標記的 FEN）、合法著法（含打入）
- 以 UCI 或 SAN 輸入著法，不合法時顯示易懂的原因
- 匯入 Crazyhouse PGN（變化與註解以資料形式保留），或直接載入 crazyhouse FEN
- 復盤棋盤：載入 PGN、pocket、含變化的著法列表、鍵盤瀏覽、翻轉棋盤
- 下自己的著法：拖曳棋子、從 pocket 拖曳，或點 pocket 棋子再點格子（合法格會標示；Esc
  取消）；支援觸控與鍵盤（聚焦棋盤後：方向鍵移動游標，Enter 選子／走子或打入已選的 pocket
  棋子）、升變選擇、輸入著法（SAN/UCI）；你的著法會形成變化，PGN 主線永遠不會被改動；
  「回到主線」回到分岔處

- 目前局面的 Fairy-Stockfish 分析（可開關）：白方視角評估條、最佳著、前幾條主要變化、
  箭頭（打入以目標格上的半透明棋子表示）；點變化中的著法即可走到該步。
  類 lichess 設定（線數、深度上限、含無限的計算時間、CPU 執行緒、記憶體），搜尋加深時即時
  顯示深度／速度／經過時間，以及停止與重新分析按鈕

- 「Why this move?」：只陳述事實的最佳著說明（打入將軍、將死、走子前後的國王逃生格、被迫應著、
  主要變化、pocket 變化）以及其他候選著的差異，另有將死威脅與懸子警示；會標明根據的深度，
  長時間或無限分析時，從深度 10 起每加深 5 層更新一次

- 「AI 解釋」：按需（也可選擇停留在局面上時自動）產生、串流顯示的 LLM 解釋，依據的正是畫面上
  的 engine 結果與事實，並知道目前的變化與實戰著法——有 `ANTHROPIC_API_KEY` 時用 Claude，
  沒有 key 時用本機 `agy` CLI（見 LLM 設定）；回答中沒有依據的著法會標示為未驗證

- 「Ask about this position」：針對目前局面或變化的快速問題與自由提問；你提到的著法（例如
  「為什麼不能 Qxe2？」「如果我改走 Qh5 呢？」）會先檢查合法性並由 engine 分析，再交給 LLM 比較；
  不合法的著法直接由規則回答

- 整局分析：由另一個 engine process 檢查每一步主線著法；不精確、錯著、大錯、錯過與放任的
  強制將死會在著法列表中標示，並列為關鍵時刻（最佳著與實戰著皆從同一局面搜尋），附可點擊的
  評估曲線圖

- 匯出 PGN：把對局連同你的變化與註解匯出成 crazyhouse PGN（複製或下載）
- 重新整理頁面會還原已載入的對局、你的變化與目前局面（只存在這個瀏覽器）

- 復原／重做：◀ / ▶（或 ← / →）前後移動，不會遺失任何內容；自己下的著法可用變化旁的 ×
  刪除

## 已知限制
- 區網內所有人共用一個互動用 engine process：兩個分頁同時分析不同局面時會互相取代對方的搜尋
  （面板顯示「已中斷」並提供「重新分析」按鈕），選很大的 Hash/Threads 也會影響所有人使用的機器。
- 自動化測試使用假的 LLM；真實回答以 `scripts/llm_smoke.py` 檢查（已用 agy 驗證）。
