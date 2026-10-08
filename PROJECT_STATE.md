<p align="right">
  <a href="PROJECT_STATE.md"><img alt="繁體中文" src="https://img.shields.io/badge/%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-0969da?style=for-the-badge"></a>
  <a href="PROJECT_STATE.en.md"><img alt="English" src="https://img.shields.io/badge/English-6e7781?style=for-the-badge"></a>
</p>

# PROJECT_STATE

Agent 各輪循環之間的持久交接文件。PLAN 前先讀，FINAL 後更新——本繁體中文版與英文版
`PROJECT_STATE.en.md` 要在同一個 commit 內一起更新。
任務規格：`task.md`（中文原文）／`task.en.md`（英文譯本）。

## 目前里程碑
Milestone 1 完成（PGN → 棋盤 → 瀏覽 → pocket → 規則 → 變化）。
Milestone 2 完成（Fairy-Stockfish → 白方視角評估 → 最佳著 → MultiPV 3 → PV、箭頭）。
Milestone 3：Analyzer + 確定性的「Why this move?」完成；LLM 層完成，並已透過本機 agy CLI
（Gemini 3.8 Flash High）以真實回答驗證。Claude 路徑仍未驗證（沒有 key）。
Milestone 4（對話 + 候選著重新分析 + 能感知變化的問答）完成；task.md §55 核心流程以假 LLM
端到端通過（e2e/core-flow.spec.ts），真實回答經 agy 通過。
整局分析（關鍵著法，task.md §30）+ 評估曲線圖完成。
類 lichess 的 engine 設定 + 串流分析完成（task.md 之後的使用者需求，2026-10-06）。
防幻覺機制（回答自動檢查、「AI 看到的資料」、真實 LLM 評測）與雙方全局掃描完成（使用者需求，2026-10-07）。
觀看者可自選 AI 來源（agy／codex／claude CLI 訂閱）、model 與 effort，清單即時從 CLI 讀取，完成（使用者需求，2026-10-07）。
題目頁完成（使用者需求，2026-10-08）：進攻／防守／中局攻防／中局對轟題，來源為對局挖題、復盤頁存成題目或不完美的自我
對弈製題；暱稱帳號與 Glicko-2 rating；可匯出 FEN／PGN／lichess。（task.md §35 原把題目與 rating 列為初期非目標，使用者明確要求。）
AI 製題完成（使用者需求，2026-10-08）：題目頁獨立的 AI 選單（agy／codex／claude、model、effort），兩種方式——agent 從 engine
候選中挑題並寫標題／提示／說明，或 agent 設計局面、engine 驗證並回饋原因重試。
Tailscale 存取完成（使用者需求，2026-10-09）：在 tailnet 上時，安裝腳本把 `100.64.0.0/10` 加入允許清單。
復盤頁「到 lichess」完成（使用者需求，2026-10-09）：目前局面開 lichess 分析棋盤、整盤上傳為 lichess 匯入對局。
分析頁改進完成（使用者需求，2026-10-09）：整局摘要與跳失誤、從錯誤中學習、自動整局分析、對局資訊、版面重排、lichess 匯入、
最近的對局、變化設為主線。
解題頁前後挪動與完整回放完成（使用者需求，2026-10-09）：棋盤下方 ⏮ ◀ ▶ ⏭ ⇅，走錯按 ◀ 重試。
題目頁改進完成（使用者需求，2026-10-09）：對手上一步與延遲回應、走錯可重試、等價好著不判錯、請 AI 解釋並存回、文字提示半分、
選題先抽題型、我的紀錄、題庫瀏覽與回報停用、分頁。

## 目前任務狀態
依 task.md 嚴格驗證（2026-10-06）發現並修正：README/PROJECT_STATE 過時、LLM context 缺
§7/§18 欄位、沒有受攻擊／受保護格（§15）、沒有 engine 深度上限（§10）、問題中第 3 個以後的
著法未經檢查就送進 LLM（§20/§22）、grounding 把問題本身／PGN 註解當成證據、以 SAN 當 React
key（§9）。之後：區網存取（systemd user service，192.168.0.0/24 允許清單）以及類 lichess 的
engine 設定（線數、深度上限、含無限的時間、threads、hash；串流快照；停止；事實面板／LLM 綁定
畫面上的 analysis_id）。再之後：文件雙語化（繁體中文 + 英文，頂端切換按鈕）。
再之後（使用者回報「自由提問送不出去」）：只要該局面有任何回答在等待中（包括 AI 解釋；agy 要 30–60 秒，
常由停留自動解釋觸發），Send 與快捷問題就被停用——現在只擋「同一個問題已在等待中」。另修正：候選著
搜尋沿用畫面上的搜尋時間且沒有上限（設 60 秒 → LLM 開始前最多等 3 分鐘）；沒有畫面上結果時的解釋
用了 review engine 的 1 條線／300 ms；串流在搜尋啟動中被取消時會留下孤兒搜尋佔住 engine（python-chess
仍會送出 `go`；無限分析時最多 10 分鐘）。
再之後（使用者擔心幻覺）：著法／評估／將殺／優勢的回答自動檢查、「AI 看到的資料」、加嚴的 system prompt、
真實 LLM 評測（`scripts/llm_eval.py`）；以及全局掃描按鈕（「全局掃描：白方／黑方 miss 的錯誤」）。
再之後：觀看者自選 AI CLI、model 與 effort，清單即時從 CLI 列舉（從不寫死）。過程中發現：手機上著法列表的
scrollIntoView 每走一步就捲動整個頁面，讓棋盤在操作中途跑掉（現在只捲動著法面板）。
再之後（使用者回報「AI 回答逾時」）：使用者用 codex 跑全局掃描時逾時（上限 195 秒；codex 沿用了個人設定——
預設 effort xhigh、caveman proxy、MCP、hooks）。現在 codex 乾淨執行、CLI 上限改為 600 秒（`LLM_CLI_TIMEOUT_S`），
等待中的回答顯示使用中的 AI 並有取消按鈕。
再之後：題目頁（見架構），並依需求嚴格檢查後補上：題目頁本身可貼 FEN 新增題目、主題標籤改為文字（不顯示代碼）、
複製的 FEN 改為通用的中括號寫法（lichess 兩種都接受——已查 chessops 原始碼並以實際 lichess 網址確認）、同一時間只跑一批製題、
重新整理後 rating 保留與手機寬度的 E2E。
再之後（使用者要求「製造題目也要可以用不同 agent 選取」，選擇兩種方式都要、題目頁獨立選單）：AI 製題（見架構）。過程中修正：
自我對弈原本先找題數兩倍的候選、再被要求兩倍（等於四倍 engine 時間）——現在只找一次約兩倍；非法局面（例如兩個王）的原因
原本是 `<Status.TOO_MANY_KINGS: 4>`，現在以文字說明哪裡不合法；設計時的構想可能與 engine 解答不符（實測），改為通過後依解答
撰寫文字；剛製造的題目可能永遠輪不到（選題只取 rating 最接近的區間——E2E 因此失敗而發現），新增題目連結 `#/puzzles/<id>`，
工作完成後列出新題目。
再之後（使用者問「題目頁哪裡可以改進」，我依程式與正式資料列出八項，使用者全選）：依據是正式題庫 46 題沒有一題有說明、
rating 1436 的玩家最近的 rating 區間 8 題裡 5 題是對轟、題目從 FEN 直接開始、走錯立刻亮出解答、製題表單排在解題區下方。
做完後在正式資料庫的副本上截圖檢查，修正 rating 圖上下刻度被裁到、題庫列表太長（改為可捲動）。
再之後（使用者找不到「再試一次」，希望像分析頁那樣可以退一步、完全前後挪動、解完能完整回放）：解題頁棋盤下方改用分析頁的
`NavControls`，「再試一次」按鈕由 ◀ 取代。過程中發現：解出時若走的是另一個將殺，回放是自己走的棋、但側欄列的是 engine 存的
解答——改為列出實際走的棋，不同時另附 engine 解答。
再之後（使用者問「分析頁哪裡可以改進」，列出八項後全選）：依據是整局分析要手動按、結果只有一長串失誤沒有摘要、右側七個面板疊成
一長條（桌機上「問 AI」約在 2000px 下方）、只能貼 PGN、只記得最後一盤、變化不能設為主線。用固定的 lichess 測試對局截圖
檢查桌機與手機版面，修正 PGN 標頭為「?」時顯示成名字的問題（頂端、摘要、對局資訊）。
再之後（使用者以為復盤頁「到 lichess 分析」的按鈕不見了——其實只有題目頁有，復盤頁從來沒有）：棋盤下方狀態列加上
「在 lichess 分析這個局面」與「上傳整盤到 lichess…」。
目前沒有進行中的任務。

## 目前架構
- `backend/` Python 3.13（uv）、FastAPI、python-chess 1.11.2。
  - `app/chess_core.py`：唯一的規則實作（python-chess `CrazyhouseBoard`）。
    標準 `PositionState` 由一條著法序列 = `root_fen` + UCI `moves` 建立。
    `position_id = sha256(root_fen|moves)[:16]` → 任何一層都能重新計算／驗證。
  - `app/pgn_import.py`：PGN → `PositionState` 樹（註解以資料保存；缺 Variant 標籤 ⇒ 視為
    crazyhouse 並設 `variant_assumed=true`；其他變體拒絕）。
  - `app/routers/game.py`：`POST /api/position`、`/api/move`、`/api/pgn`；`GET /api/health`。
    客戶端送來的 `position_id` 會被驗證（不符回 409）。
  - `pgn_import.export_pgn` + `POST /api/export`：樹節點（前序、主線優先）→ 經 python-chess
    產生 PGN；每步重播重新驗證；設定 Variant/SetUp/FEN 標籤；註解中的大括號由 python-chess 移除。
    前端 ExportPanel（複製／下載 .pgn），已做來回轉換測試。
  - `app/models.py`：pydantic schema。Move = {uci, san, from, to, drop, promotion, is_capture}。
  - `app/engine.py` EngineService：一個 Fairy-Stockfish 14 process（python-chess async UCI；
    python-chess 依 CrazyhouseBoard 設定 `UCI_Variant crazyhouse`）。較新的請求會停止正在跑的搜尋
    （generation 計數；被取代 → status "cancelled"，永不快取）。LRU 快取鍵為
    (position_id, multipv, movetime)。逾時／崩潰 → 重啟 process。`analysis_id` = 結果內容的 hash
    （作為 LLM 快取鍵）。分數正規化為白方視角（`evaluation` 單位為兵、`mate` 白正黑負、
    `evaluation_pov: "white"`）。
  - `app/routers/engine.py`：`POST /api/analyze`（position_id 不符 409、`game_over` 狀態、
    503 `engine_unavailable`）。`app/config.py`：ENGINE_PATH/THREADS(4)/HASH_MB(256)/MOVETIME_MS(1500)。
  - 相同的並行 engine 請求共用一次搜尋（`_inflight`，shielded）；只有不同的請求會取代。
  - 每個請求自帶 `SearchSettings` 的串流分析（multipv 1–5、深度上限|None、movetime
    100 ms–10 分鐘|None = 無限、threads 1–(CPU 數−1)、hash 16–4096 MB）：`EngineService.stream()`
    每次搜尋前設定 Threads/Hash，產生 `running` 快照（每 0.25 秒或深度增加時；含
    nodes/nps/elapsed/settings），結束時為 `ok`（達上限或 `stop(position_id)`）或 `cancelled`
    （被取代，不快取）；無限搜尋上限 10 分鐘且永不快取（再次造訪會繼續搜尋）。每個結果與快照都依
    `analysis_id` 記住（LRU 512，`find()`）。`POST /api/analyze/stream`（SSE
    `snapshot`/`done`/`error`）、`POST /api/analyze/stop`。串流在搜尋啟動中被取消時，讓啟動完成
    （shielded）後立刻停止，且下一個指令會等這次啟動結束（`_abandoned`，在 `_ensure_started` 中）：否則
    python-chess 會在取消之後仍開始搜尋，而且沒有人去停止它。
  - `/api/insights` 與 `/api/explain(/stream)` 接收畫面上的 `analysis_id` 並重用完全相同的結果
    （`resolve_analysis`：先找互動 engine，再找 review engine）；沒有 id 時在 review engine 上搜尋
    （protected），使用互動 engine 的預設值（3 條線、ENGINE_MOVETIME_MS）。候選著搜尋使用畫面上的搜尋
    時間，但上限為 ENGINE_MAX_MOVETIME_MS（無限 → ENGINE_MOVETIME_MS）。候選著／威脅搜尋一律在
    review engine 執行，所以事實面板與提問永遠不會打斷觀看者
    的分析。Insights 帶有 `engine_status`（含 `running`）與 `depth`。
  - `app/analyzer.py`：確定性事實。局面：將軍／將軍子、雙方國王逃生格（以空著視角計算國王的合法
    步）、王區攻擊、pocket、懸子（可合法吃掉且無保護）、受攻擊的后／車、各 pocket 棋子的打入將軍格、
    一步殺、對手的一步殺威脅。著法：將軍／將死／吃子（吃到升變子標示 `X~`）／打入／升變／閃擊將軍、
    受攻擊的王／后／車、對方國王逃生格前→後、pocket 前→後、應著數 + 被迫應著（≤3）、標籤
    （drop_check、drop_mate、queen_drop、interposition_drop、knight_fork、double_attack、
    escape_square_reduction…）。PV：每 ply 的將軍／打入 + 走子方連續將軍數。`POST /api/insights`
    → Insights。
    每步的線路事實：`discovered_attacks`（走子方其他長程子新攻擊到的敵子）、`blocked_lines`
    （被移動／打入的棋子擋住的敵方長程子對我方棋子的攻擊）、`opened_file`（兵吃子後讓該線成為
    開放／半開放線）、`threatens_mate`（若對手停一手則下一步可一步殺）。局面 `threat`：對空著後局面
    的 engine 搜尋（`run_threat`，THREAT_MOVETIME_MS=400，被將軍時略過）——也會放進 LLM context。
    另有：`defenses_to_mate_threats`（走完後對手沒有一步殺的著法；依序為安靜的打入、安靜的著法、
    再來是將軍——將軍只是延後）、`en_prise_to`（能有利地吃掉剛移動棋子的對方棋子 → 該子會進入對方
    pocket）、標籤 `piece_en_prise`、`pocket_emptied`；雙方各自的 `king_zone_attackers`、
    `board_material`。
    寫 analyzer 測試時注意：pocket 中的棋子會改變是否為將死（手上的棋子可以擋），這推翻了好幾個
    手寫測試的假設——要實際計算，不要假設。
  - Engine 取代規則：只有「不同局面」的請求會停止正在跑的搜尋（generation 遞增）；同局面但設定不同
    的請求會排隊（E2E 發現：UI 的快速分析曾經取消使用者的解釋請求）。`protected=True` 的搜尋
    （解釋、其候選著與威脅）不會停止別人、也不會被停止——瀏覽會排在它們後面；加入了某個被取代之
    共享搜尋的 protected 呼叫者會重跑。
  - `app/llm/`：`provider.py`（`LLMProvider` protocol；`AnthropicProvider` = 官方 SDK、
    `claude-opus-5-5`、effort medium、`fallbacks="default"` + beta `server-side-fallback-2026-07-01`、
    處理拒答、型別化錯誤鏈 → 安全的中文訊息、key 只從環境變數／.env 讀取；`FakeProvider` 為測試
    回傳 context），`system_prompt.md`（task.md §19/§20/§33/§34），`context.py`（task.md §18 的
    context 由 server 依著法序列 + engine + analyzer 建立；PGN 註解／標頭以資料傳入；跳脫 `<`/`>`，
    讓不可信文字無法關閉 `<position_context>` 區塊；客戶端的 `game_move` 會重新驗證，不合法就丟棄），
    `service.py`（快取鍵 = context（含 position_id、variation_id、analysis_id）+ 問題 + 歷史 +
    模型 + context/prompt 版本）。`POST /api/explain`（503 llm_unavailable、502 llm_error、
    409 局面不符／engine 被取代）。`LLM_PROVIDER` anthropic|fake|none。
    Provider 以串流為主（`stream()` 先產生文字片段，最後一個 LLMResult；Anthropic 透過
    `client.beta.messages.stream` + `text_stream` + `get_final_message`；拒答鏈 → 捨棄部分輸出）。
    `POST /api/explain/stream` = SSE `meta`/`delta`/`done`/`error`；驗證／engine 錯誤在串流開始前
    以一般 HTTP 錯誤回傳；快取命中只送 meta + done。
  - `AgyProvider`（provider.py）：沒有 Anthropic key 時使用者的選擇——以
    `agy -p <prompt> --model gemini-3.8-flash-high --output-format stream-json --mode plan --sandbox --print-timeout`
    執行，不經 shell，cwd = 私有的空暫存目錄；prompt = system prompt + 「不得使用工具」規則 + 先前
    對話 + 問題（agy 沒有 system 角色；資料邊界仍由跳脫過的 `<position_context>` 維持）。
    解析 `step_update.text_delta`（agent_response）與最後的 `result`（SUCCESS/ERROR）；exit 1/3、
    逾時（print-timeout + AGY_GRACE_S）→ LLMError，登入／認證錯誤 → LLMUnavailable；串流提早關閉時
    結束 process；同時讀取 stderr。**不要**加 `--disable-slash-commands`：加了之後 agy 會忽略
    `--mode plan`。預設 `LLM_PROVIDER=auto`。錄下的真實輸出：`tests/fixtures/agy_stream_*.ndjson`。
  - `app/llm/grounding.py` `check_answer(answer, context, board|None)` → `ExplainResponse.warnings`
    （`AnswerWarning{kind, quote, detail}`）：`illegal_move`（目前不合法且不在 context 中）；`unanalysed_move`
    （目前合法、使用者提到但未分析，或 AI 自行推演的後續——空著後或 engine 第一步後合法；board 為 None
    （整局掃描）時則是資料中沒有的任何著法）；`evaluation`（帶正負號的數字與 context 任何評估的絕對值都不符，
    容許 ±0.15，整數 ±0.5；「mate -1」略過）；`mate`（「N 步殺／mate in N／#N／M N」超過 context 中最長的
    將殺；一步殺清單與 `threatens_mate_in_one_next` 算 1；中文說法只在同一子句提到某方或著法時才檢查）；
    `advantage`（「白方優勢／對黑方有利…」但沒有任何評估對該方 ≥ 0.2）。同一子句前面有否定詞時不檢查。
    證據不含 user_question、PGN 註解／標頭與未分析的候選著；規則算出的打入將軍（"N@h6"）算證據。
    每個回答也帶 `prompt`（`PromptRecord{system, messages}`，由 `service.build_messages` 產生，正是 provider
    收到的內容；規則回答時為 None），在 AnswerView 顯示為「AI 看到的資料」。`scripts/llm_smoke.py`：對真實
    provider 跑 4 個固定案例（有回答、中文、沒有警告、切題）。`scripts/llm_eval.py`：14 個局面（每盤
    lichess fixture 4 個 + 2 個戰術局面）×（預設解釋 + 一個快捷問題），報告與含每題 context 的 JSON 寫到
    `backend/reports/`（git-ignore）；`--recheck file.json` 不呼叫 LLM 重新套用檢查。
  - AI 選擇：`app/llm/provider.py` `CliProvider`（共用執行流程：私有空暫存目錄、stdin 或 argv 傳 prompt、
    期限 = timeout + CLI_GRACE_S、提早關閉時結束程序、同時讀取 stderr、認證錯誤 → LLMUnavailable；上限 = `LLM_CLI_TIMEOUT_S`（600，後備 AGY_TIMEOUT_S），逾時訊息寫明哪個 AI、上限與
    可嘗試的做法），子類別
    `AgyProvider`（`-p`、`--model`、`--effort`、plan mode、sandbox）、`CodexProvider`（`exec --json
    --skip-git-repo-check --ephemeral -s read-only -C dir` + `CODEX_CLEAN`（`--ignore-user-config --ignore-rules
    --disable hooks/plugins/apps/shell_tool/shell_snapshot/multi_agent/browser_use/computer_use`）`[-m]
    [-c model_reasoning_effort="E"] -`，prompt 走 stdin，最後一次給出完整 agent_message，沒有逐字串流；
    ~/.codex/AGENTS.md 仍會被讀取——沒有工具可用，因此不起作用）、`ClaudeCliProvider`（`-p --output-format
    stream-json --include-partial-messages --verbose --system-prompt S --tools "" --no-session-persistence
    --strict-mcp-config --setting-sources "" [--model] [--effort]`，prompt 走 stdin；不用 `--bare`，它不讀
    訂閱登入）。Provider 名稱 = `cli:model (effort)`（屬於 LLM 快取鍵）。`app/llm/catalog.py` `ProviderPool`：
    清單來自 `agy models` + `agy --help`（help 印在 stderr）、`codex debug models`（visibility "list"、各
    model 的 reasoning 等級；CLI 預設 model 提供聯集）、`claude --help`（`--model` 別名、`--effort` 清單）；
    快取 ≤ 2 分鐘，`GET /api/llm/catalog?refresh=true` 重新讀取；`provider(choice)` 驗證（未知時重讀一次）
    → `ChoiceError` → 422 `llm_choice`；每個（cli, model, effort）一個實例。`LlmChoice` 欄位有字元限制
    （不能夾帶參數）。`ExplainRequest.llm`／`GameScanRequest.llm`；None = 伺服器預設（LLM_PROVIDER）。
  - `app/llm/game_scan.py` + `POST /api/explain/game/stream`（`GameScanRequest{line, side, headers}`）：
    啟動或沿用整局分析工作，分析期間以 SSE `progress` 回報，完成後取該方被判錯的著法（最嚴重 12 個、依時間
    順序；走子方由 root 的 ply 奇偶判斷），附走子前 fen／pocket、engine 最佳線、實戰著後的變化（review
    engine、快取搜尋、protected）與兩步棋的規則事實 → context `task: "game_scan"`（system prompt 有「整局掃描」
    段落）；沒有被判錯的著法 → 規則回答，不呼叫 LLM。回應為 ExplainResponse（analysis_id = 整局分析工作 id，
    warnings 以 check_answer(board=None) 產生，含 prompt）。
  - `app/llm/candidates.py`（task.md §22）：問題中提到的著法（SAN/UCI/打入/易位，可緊鄰中文字；
    單獨的格子只在是合法兵步時算；最多 10 個）→ 全部檢查合法性（不合法 → 中文原因）→ 命中 MultiPV
    （免費），或對走完該著後的局面重新做 engine 搜尋（相同 multipv/movetime，每個問題最多 3 次；
    其餘合法著法 → `not_analyzed`）→ 著法事實 → LLM context 中的 `candidate_analysis`。若提到的著法
    全都不合法，則由規則回答（`model: "rules"`），不用 engine、不用 LLM。回應含 `checked_moves`。
    Grounding 不把 `user_question`、PGN 註解／標頭與未分析的著法當成證據。
  - chess_core 中給使用者看的不合法著法原因為繁體中文。
  - `app/review.py` + `routers/review.py`：整局分析工作（`POST /api/review`、
    `GET /api/review/{id}`，存在記憶體，依著法序列去重）在「第二個」engine process 上執行（2 threads，
    REVIEW_MOVETIME_MS=300），因此永不取代互動分析。每一步與 engine 最佳著不同的實戰著，都從「同一個」
    局面以 `root_moves=[played]`（UCI searchmoves）搜尋——用各自的短搜尋比較著法前後的局面，曾產生
    交替出現的假大錯（走子方偏差，經由截圖發現）。判定：lichess 勝率下降 0.1/0.2/0.3，cp×0.5
    （crazyhouse 尺度的經驗值）+ 考慮將死（mate_missed、mate_allowed；局面已經勝負已定時降級或忽略）。
  - `POST /api/review/judge`（從錯誤中學習）：`ReviewService.judge` 在 review engine 上以 protected 搜尋（不會被進行中的
    整局分析中斷）比較最佳線與 `root_moves=(著法,)`，各 1000 ms，重用 `classify`／`winning_chances`；將死直接算好著；
    已結束的局面與不合法著法 422。
  - `EngineService.analyse(..., root_moves=())`——屬於快取鍵的一部分。
  - `scripts/fetch_engine.sh` → `engines/fairy-stockfish`（git-ignore；fairy_sf_14 release，此機用 bmi2
    版本，sha256 9c8ff22d…）+ crazyhouse NNUE `engines/crazyhouse-8ebf84784ad2.nnue`（55.8 MB，依
    fairy-stockfish.github.io/nnue 比傳統評估強 +1136 Elo；驗證 sha256 前綴；這個 2022 年網路未註明
    授權 → 只在本機下載，永不 commit）。`EngineSettings.eval_file`（ENGINE_EVAL_FILE，空 = 傳統評估）；
    engine 名稱以 " NNUE"/" classical" 結尾，讓 analysis_id 與快取不會混用兩者。已透過 python-chess
    確認 NNUE 有啟用（FSF info string）。
- 題目（`backend/app/puzzles/`）：`store.py` 為 DATA_DIR 中的 SQLite（題目以 (fen, type) 唯一、玩家暱稱唯一（不分大小寫）、
  作答以 (玩家, 題目) 唯一＝只有第一次作答計分）；`rating.py` Glicko-2（測試對照論文範例；RD 下限 45）；`miner.py` 在「第三個」
  engine process 上執行（`puzzle_engine_settings`，2 threads、500 ms，所有搜尋 protected）：`unique()`＝最佳與次佳勝率差 ≥ 0.35
  （整局分析的尺度），一步殺一律算唯一（任何將殺都接受），較長的將殺必須是唯一的將殺；進攻（將殺 ≤ 7 或 ≥ 0.6，且前一步
  還沒贏定）、防守（空著威脅讓對手 ≥ 0.5、最佳 ≥ −0.3 且 < 0.6）、中局攻防（解題方 ≥ 3 步、ply ≥ 16、對手威脅 ≥ 0.2）、對轟
  （ply ≥ 16、|勝率| ≤ 0.35、`tense()`：雙方王區受攻擊、雙方 pocket 非空且可打入將軍；6 步）；`solution()` 依序走唯一好著與 engine
  回應（≤ 6 步，將殺 ≤ 7），以解題方著法結束；`hardness()`：深度 2／6 選的著不同、明明有強制著卻是安靜著、棄子（en prise）、
  次佳是誘人的將軍或吃子 → 初始 rating 1100 + 150·(步數−1) + 700·難度（對轟 1400 + 600·難度）；`mine_line` 跳過已在解答內的局面。
  `generator.py`：從 `openings.py`（8 條常見開局、6–14 ply）自我對弈，120 ms 搜尋，在 0.25 以內時依 .7/.2/.1 選最佳／次佳／第三，
  再挖題並依難度排序（約題數的兩倍，讓呼叫端挑）。`agent.py`（AI 製題）：`curate` 把候選（最多 12 個，依難度）的局面、
  pocket、解答線（SAN）、engine 前三線與解題方勝率、難度訊號放進跳脫過的 `<puzzle_candidates>` JSON 區塊，agent 回 JSON 挑題並寫
  標題／提示／說明；只接受清單內 id（不重複），沒有 AI、失敗或 JSON 無法使用時改依難度挑。`design` 把題型、描述與一個真實開局
  局面當參考放進 `<puzzle_request>`，agent 回 `fen`／`title`／`hint`／`idea`；`miner.invalid` 與 `miner.diagnose` 說明不合格原因
  （FEN 無效、局面不合法、沒有唯一解並附差距、勝率不足、沒有威脅、守不住、已經大優、步數不足、不夠接近或不夠緊張，附 engine
  前幾名）並以對話形式回饋，最多 4 次；通過後以同一套挑題 prompt（單一候選）請 agent 依 engine 解答寫文字（設計時的構想可能
  與解答不符——實測 agy 的構想寫「先打入馬引離」而解答是 Qxf8#——所以不顯示），寫不出來時保留設計時的標題與提示。`_write`：標題或提示含第一步的著法（SAN／UCI）或其格子就丟掉；說明以 `check_answer`
  檢查並存下警告；記錄是哪個 agent（`model`）。Prompt 在 `puzzles/prompts/curate.md`、`design.md`。`store.py` 啟動時替舊資料庫
  補上 `title`／`hint`／`explanation`／`ai`／`ai_warnings` 欄位。`service.py`：下一題（±100 逐步放寬）、無狀態判定（序列必須是解答的前綴）、提示（算失敗）、看解答、對轟
  每步（同局面 + root_moves 搜尋評語；結果與開局比 ±0.2）、匯出（`lichess_fen` 把 pocket 當第 9 列；PGN 只在作答後含解答）、
  手動新增（engine 驗證，不適合時說明原因）、背景挖題／製題工作（製題帶 `mode`、題型、描述與 `llm`；`chosen_provider` 驗證
  所選 AI（422），沒選則用伺服器預設；設計模式沒有 AI 時 422；工作紀錄 `log` 與使用的 `ai`）；提示回傳 agent 的文字提示（只在
  第一步），解題結束時回傳說明與警告；`GET /api/puzzles/{id}` 開啟指定題目（題目連結），工作完成時 `made` 列出存入的題目，
  重複新增的訊息附上既有題目編號（`store.find`）。題目頁改進：`Puzzle.before_fen`／`last_move`（挖題與從一條線存成題目時寫入，
  舊題留空）；`move` 改 async——任何將殺都算解出，非答案著先用 `miner.lines(root_moves=…)` 比較，勝率差 ≤ `EQUIVALENT_GAP`（0.1）
  回 `alternative`（不結束、不計分），否則失敗；失敗後重試走同一個 API，`store.record` 只記第一次所以不計分；`hint_level` 0／1／2
  → `HINT_SCORES` 1／0.5／0；`explain`（`POST /api/puzzles/{id}/explain`）只限已作答的玩家、已有說明就直接回傳，否則以
  `agent.explain`（單一候選的挑題 prompt，保留既有標題提示）撰寫並 `store.set_texts` 存回，每題一把 `asyncio.Lock`；
  `store.next_for` 先 `random.sample` 題型再依 rating 視窗找、排除停用；`disabled`／`report` 欄位與 report／restore 端點，
  `counts` 不含停用；`GET /api/puzzles`（全部摘要）、`GET /api/players/{nickname}/history`（最近 100 筆與各題型平均）。路由 `routers/puzzles.py`；測試用自己的 DATA_DIR
  （`tests/conftest.py`），E2E 每次執行用全新的暫存 DATA_DIR。
- `frontend/` React 19 + TS + Vite 8 + Chessground 9.2。瀏覽器中「沒有」規則邏輯。
  - `src/tree.ts`：由 backend 局面組成的純對局樹（id = position_id）。每次插入都檢查不變式（子節點
    的著法序列 = 父節點序列 + 1 步）。`variationId` = "main" 或 `v:<第一個節點 id>`；`origin`
    pgn|user；使用者的著法永遠不會併入主線（即使在 PGN 最後一步之後）。
  - `src/useReview.ts`：reducer（tree、activeId）；以載入 generation 防止過時的載入；剛下的著法只有
    在使用者仍停在其父節點時才會成為目前局面。
  - `src/components/`：Board（chessground 包裝，`data-fen`/`data-position-id` 屬性）、
    Pocket（重用 chessground 棋子圖）、MoveList（lichess 式的行內變化）、NavControls（按鈕 +
    ←/→/Home/End/↑/↓，f = 翻轉）、PgnLoader、MoveInput（SAN/UCI 文字）、ReviewBoard（棋盤 + pocket
    + 升變選擇；每一步都送到 backend；被拒絕的著法會遞增 `syncKey`，讓 chessground 重新同步到標準 FEN）。
  - `src/moves.ts`：合法 UCI 清單 → chessground 目的格／打入格／升變選項。
  - Chessground 會快取棋盤邊界；ReviewBoard 在每次 pointer-down 時清除（否則棋盤上方的版面位移會讓
    打入落到錯的格子——E2E 發現的真實 bug）。
  - MoveList：節點的延續是 variationId「相同」的子節點；其他子節點顯示為（變化）。
  - `src/useEngine.ts`：debounce 120 ms，以觀看者的設定做一次串流搜尋（`src/engineSettings.ts`，
    localStorage，限制在介面提供的選項內）；key = position_id + 設定 + 重新分析計數；變更時 abort
    會關閉串流（server 停止搜尋）；狀態 analyzing/done/stopped/error；長時間搜尋（≥10 秒或無限）會
    發布深度里程碑（10、15、20…）給事實面板。結果只對它自己的 key／局面公開。
  - EnginePanel ⚙ → `EngineSettings` 表單；進度列「depth d / 上限 · nps · 經過時間 / 上限」；
    停止（保留結果）與 重新分析（中斷或錯誤後）。
  - EnginePanel（白方視角評估 + 評估條、最佳著、MultiPV 各線；點 PV 著法會透過 `playLine` 走到該處），
    `engineShapes.ts`（箭頭；打入 = 圓圈，最佳打入另加半透明棋子）。
  - `src/llmRequest.ts`：樹 → LLM metadata（variation_id、on_main_line、此處或分岔點的實戰著法、
    路徑上的 PGN 註解、標頭）。`src/useConversation.ts`：每個 (position_id, variation_id) 各自的對話；
    回答落在提問時的那個對話（遲到的回答永遠不會顯示在其他局面）；追問會送出最近 6 輪問答。
    回答以串流方式（fetch 上的 `readSse`，TextDecoder 串流模式）逐步顯示。
  - 自動解釋（選用，`src/preferences.ts` localStorage 布林值）：只有在目前局面的分析完成「且」使用者
    停留 1.5 秒後才問預設問題；每個對話一次請求（回答／快取會重用）。除非焦點在文字欄位或下拉選單，
    方向鍵用於瀏覽。
  - 工作階段還原（`src/session.ts`）：localStorage 只保存來源（PGN 文字／FEN）與使用者建立之節點的 UCI
    序列 + 目前的序列；載入時 `restore()` 重新匯入來源並透過 `/api/move` 重播使用者著法（一切由
    backend 驗證），再選回目前序列。區分「被取代」與「失敗」的還原（StrictMode 會掛載兩次）；失敗或
    損壞的工作階段會改為新對局並清除。
  - LLM 請求帶有 `viewer_side`（棋盤方向）；context `game.viewer_side`（ctx-v2）與 system prompt 說明
    「我/我的」= 觀看者那一方（否則為走子方），且所指棋子不存在時要直說而不是猜。AnswerView + RichText
    （安全的極簡 markdown）。WhyPanel 有按需的「AI 解釋」按鈕。
  - `src/aiChoice.ts`（`useAiChoice`：儲存的選擇、載入時與開啟設定時讀取清單、`sanitizeChoice` 把清單已不提供
    的選項改回預設並提示）+ `AiSettings`（Ask 面板的 ⚙：來源／model／effort 下拉，effort 依 model）；
    WhyPanel 顯示目前的 AI。E2E 用的假 CLI：`frontend/e2e/fake-cli/`（agy/codex/claude 符號連結到
    fake_cli.py；透過 `FAKE_CLI_STATE` 改變清單）。
  - MoveList 只捲動自己的面板來顯示目前著法（`revealInPanel`），絕不捲動整個頁面。
  - 取消：`useConversation.cancel(id)`／`useGameScan.cancel(side)` 中止請求（該則顯示 CANCELLED）；SSE 串流關閉後
    伺服器會關閉 provider 串流並結束 CLI 程序。Turn 帶有 `aiLabel`（等待時顯示）。E2E 拖曳輔助函式會先把棋盤捲進畫面。
  - `src/useGameScan.ts`：依主線（root_fen + moves）與哪一方記錄 pending／整局分析進度／部分回答／回答；
    主線改變時中止並隱藏掃描；請求以 id 防止舊回答覆蓋。App 同時啟動整局分析面板（後端同一個工作），
    ChatPanel 顯示兩個掃描按鈕與結果。
  - ChatPanel（"Ask about this position"）：快速問題（task.md §23，用實際的最佳／次佳／實戰著 SAN 組成）
    與自由提問，走同一條 `/api/explain` 流程；在每個回答上方顯示檢查過的著法（不合法原因／engine 分數
    + 來源）。提問永遠不必等其他回答完成（可同時有多個在進行；追問歷史只帶已完成的問答）；只有
    「同一個問題仍在等待中」時不能重複送出。
  - `useGameReview`（啟動 + 輪詢；只在分析過的那條主線上顯示）、著法列表符號（?! ? ?? ?# ??#）與最佳著
    對實戰著的提示、ReviewPanel（關鍵時刻，可點擊）。
  - EvalGraph（`src/evalGraph.ts` 幾何 + 元件）：主線每 ply 的白方勝率（與 backend 相同的曲線／尺度），
    中線以上白色、以下深色，標記著法上有狀態色圓點（index.css 中的狀態 token，一律搭配符號 + 文字），
    十字準線提示、點擊跳轉、目前 ply 線。
  - `src/useInsights.ts` 取得最終結果的 insights，或長時間搜尋最新里程碑的 insights，並傳入其
    analysis_id（以 position_id + analysis_id 為鍵；新的事實載入時，同一局面先前的事實保持顯示）；
    WhyPanel 標明深度。`src/explain.ts` 把事實轉成只陳述事實的繁體中文句子（直接效果、國王安全、
    應著、PV、pocket、以走子方視角的候選著比較、警示）；`WhyPanel` 顯示它們（對局結束時顯示上一步）。
  - 頁面：`src/route.ts`（hash：`#/` 復盤、`#/puzzles`），`Root.tsx` 只掛載畫面上的頁面，`components/Nav.tsx`。題目頁
    `src/puzzles/`（`usePlayer`、`usePuzzle`、`PuzzlePage`、`PuzzleLibrary`）；復盤頁的 `components/PuzzleTools.tsx`（存成題目、
    從這盤挖題）；`session.openInReview(pgn)` 把題目交給復盤頁；`clipboard.ts` 複製時有 execCommand 備援（區網 http 位址沒有
    navigator.clipboard）。`PuzzleLibrary` 的「AI 製題」用 `useAiChoice('crazyhouse-review:puzzle-ai-choice')`（與復盤頁分開記住）
    與共用的 `AiSettings`，選方式、題型、描述與題數，輪詢工作並顯示最後幾行紀錄；`usePuzzle` 的提示分兩段（`hintLevel`
    1＝agent 文字、2＝要動的棋子），結束時存下說明與警告；`route.usePuzzleRoute` 讀 `#/puzzles/<id>`，登入後開啟該題
    （effect 依暱稱而非 player 物件，rating 更新時不會重載題目），「下一題」離開連結。分頁：`route.usePuzzleRoute()` →
    `{tab: solve|library|history, id}`；`PuzzlePage` 持有題目頁唯一的 AI 選擇（製題與請 AI 解釋共用）；`usePuzzle` 記錄
    `line`（走過的棋，含對手回應與錯著）＋`lineSan`＋`correct`（其中已知正確的長度）＋`cursor`；`replayTrack`＝（有上一步時）
    對手上一步＋走過的棋，失敗看解答後改為解答線；`navigate(◀▶⏮⏭ 或指定步)` 只移動游標，走錯後退回錯著之前即轉為重試；
    在游標處走棋：與已知正確的下一步相同就只前進，否則以游標前的正確前綴送伺服器判定；對轟只能在最新局面走；
    `INTRO_MS` 600／`REPLY_MS` 500，狀態 `intro`、`revealed`、`retrying`、`hintUsed`（決定分數）、`explaining`；`PuzzlePage`
    重用 `NavControls`（翻轉只影響這一題）；`PuzzleLibrary`（列表、篩選、恢復）+ `PuzzleMaker`（AI 製題、貼 FEN）；
    `PuzzleHistory`（`ratingGraph.ts` 算刻度與座標，單一數列 SVG、十字線與提示框、方向鍵）。
  - 分析頁版面（`App.tsx`）：`.review-layout` 三區 grid（棋盤｜側欄／棋盤下方｜側欄；手機 棋盤→側欄→棋盤下方）；
    棋盤下方是狀態（FEN、回到主線）、輸入著法、`ReviewPanel`、`LearnPanel`；側欄是 `EnginePanel`、`MoveList`、分頁
    「為什麼｜問 AI｜對局與工具」（分頁內容保持掛載只隱藏，選擇記在 localStorage）。`reviewSummary.ts`：lichess 每步準確度
    103.1668·e^(−0.04354·勝率下降%)−3.1669 取平均＋各分類次數；`ReviewPanel` 篩選一方／不精確、上一個／下一個失誤
    （p／n，`typing.isTyping` 與 `NavControls` 共用）；`useGameReview(tree, auto)` 在主線（root_fen＋著法）改變且還沒有
    對應工作時自動開始（偏好 `auto-review`，預設開）。`useLearn`：從整局分析取一方的錯著／大錯／殺棋失誤，`select` 到失誤前
    局面；在該局面走棋交給 `attempt`（judge，棋盤一律退回、不加進棋譜），練習時隱藏 engine 面板、箭頭、為什麼與失誤列表；
    看答案用 `api.move` 把最佳著 SAN 轉成箭頭。`GameInfo`＋`gameInfo.ts`（`known` 濾掉「?」、時限、日期、lichess 原局）。
    `lichess.ts`：解析對局網址／ID，瀏覽器直接 `fetch` lichess（`/game/export/{id}`、`/api/games/user/{name}` ndjson；
    lichess API 回 `Access-Control-Allow-Origin: *`），404／429／網路錯誤以中文說明。`session.ts`：最近 10 盤
    （`sourceKey` 去重）與主線終點著法；`tree.promote`／`makeMainline` 互換 variationId 與 `children` 順序，`useReview`
    的 `promoteToMain`、`openRecent`，重建時套用 `makeMainline`。`LichessLinks`（狀態列）：`lichessAnalysisUrl`（pocket 寫成
    第 9 列，與後端 `lichess_fen` 同規則；黑方視角 `?color=black`）；上傳先確認，點擊當下先開分頁（避免被擋），`exportPgn` 後
    `importToLichess`（`POST /api/import` form `pgn`），成功導向對局網址並留下連結，失敗關掉分頁顯示原因。
  - Vite dev server :5180 把 `/api` 代理到 backend :8820。
  - 區網部署：`scripts/install_service.sh` → systemd user service `crazyhouse-review`（已啟用，
    Linger=yes 所以開機即啟動）執行 `scripts/run_server.sh`，HOST=0.0.0.0、PORT=8820、
    ALLOWED_CLIENT_NETWORKS=127.0.0.0/8,::1/128,192.168.0.0/24，`tailscale ip -4` 可用時（且沒有 `TAILSCALE=0`）
    再加上 Tailscale 的 IPv4 範圍 `100.64.0.0/10`（服務只聽 IPv4，所以不加 IPv6 範圍；tailnet 內誰能連由 ACL 決定），
    並印出 tailnet IP 與 MagicDNS 網址。`app/access.py`（純 ASGI）對其他來源位址一律回 403（忽略 X-Forwarded-For）：
    已驗證 tailnet IP 100.70.168.53 與 MagicDNS 名稱 → 200（原本 403）、區網 → 200、Docker container → 403——Docker
    bridge 流量會繞過 ufw 到達該 port，所以 app 層的允許清單是必要的。ufw（預設 DROP）需要
    `sudo ufw allow from 192.168.0.0/24 to any port 8820 proto tcp`；tailnet 若被擋，另需
    `sudo ufw allow in on tailscale0 to any port 8820 proto tcp`（由使用者執行；這裡沒有 sudo）。`scripts/serve.sh` 建置 UI，backend 在 `/` 提供
    `frontend/dist`（StaticFiles 掛在 API 路由之後）。
  - 點擊打入：點 pocket 會切換選取並同步到 chessground 的打入模式；每次選取只接受一次棋盤點擊，之後
    重新同步（否則點到有子的格子會留下 chessground 的棋盤外佔位）；Esc 取消。
  - 觸控：chessground 會取消 touchend 的預設動作，所以點按永遠不會變成 click → Pocket 自己偵測點按
    （touchstart→touchend < 10px），並忽略 600 ms 內的相容性 click。Pocket 格為 role=button（只有可用時
    才有 tabindex），Enter/Space 選取；輸入打入著法（MoveInput "N@d6"）可用鍵盤完成。
  - 鍵盤棋盤（`src/keyboardBoard.ts` + ReviewBoard）：棋盤外框可聚焦（role=application）；第一次按鍵
    才顯示游標（滑鼠使用者看不到），方向鍵依棋盤方向移動游標，棋盤有焦點時「不會」瀏覽著法列表，
    Enter/Space = chessground selectSquare（選子／走子，照常出現升變對話框）或打入已選的 pocket 棋子，
    Esc 取消；aria-live 區域朗讀格子 + 棋子。
  - 載入器接受 PGN 或單行 crazyhouse FEN（`looksLikeFen`；中括號或 lichess "/pocket" 格式，由 backend
    正規化）。Engine 開關（localStorage 偏好設定，try/catch）。

## 已完成功能
- Crazyhouse 標準局面、著法解析（UCI 或 SAN），不合法著法有中文原因。
- PGN 匯入（變化／註解）與直接載入 crazyhouse FEN；PGN 匯出（複製／下載）。
- UI：棋盤 + pocket、含變化／註解的著法列表、瀏覽、翻轉；重新整理後還原工作階段。
- 互動：滑鼠拖曳、pocket 拖曳／點擊打入、觸控（點按打入、拖曳）、鍵盤棋盤游標 + 輸入著法；升變選擇；
  使用者變化（× 刪除）、「回到主線」。復原／重做 = ◀/▶ 瀏覽（不會遺失任何內容）+ × 移除下過的變化。
- Engine：Fairy-Stockfish 14 + crazyhouse NNUE、白方視角分數、將死分數、箭頭／打入標記、點擊走 PV、
  開關；空著威脅分析；觀看者設定（線數 1–5、深度上限、含無限的時間、threads、hash），即時串流深度、
  停止／重新分析。
- 「Why this move?」面板：只陳述事實的說明（直接效果、國王逃生格、應著、PV、pocket、線路效果、
  將死威脅 + 防守、可被吃的棋子）與候選著比較。
- LLM：Claude 或本機 agy；按需／停留自動解釋；含快速問題的對話；每個提到的著法都檢查合法性，最多 3 次
  新的 engine 搜尋，其餘標示為未分析；串流回答；回答中沒有依據的著法會被標示。
- 整局分析：每步判定（不精確 … 錯過／放任將死）+ 可點擊的評估曲線圖。
- 新對局（沒有 PGN）：使用者的第一條序列就是主線。PGN 對局：使用者的著法一律是變化；PGN 主線永不修改。

## 重要決策
- Backend 是規則權威；前端樹只存放 backend 產生的局面。
- 標準局面（task.md §7）= backend `PositionState` + 樹節點的 `variation_id`；每個 LLM 請求都會一起
  序列化兩者（context `position` 區塊：position_id、variation_id、ply、fen、side_to_move、
  white/black pocket、move_history、last_move、升變棋子）。
- position_id 以著法序列為單位（換序到達的相同局面有不同 id；歷史很重要）。
- 兵的打入 SAN 以 lichess 風格 `P@e4` 顯示（python-chess 輸出 `@e4`）。
- 本機 port 8765 已被其他服務占用；backend 開發用 8820。
- Playwright 使用自己的 port（8821/5181）且從不重用 server（過時的 dev server 曾造成錯誤結果）。
- 文件為雙語：`X.md`（繁體中文，預設）+ `X.en.md`（英文），兩者開頭都是相同的語言切換按鈕（相對連結
  內放 shields.io 圖片；目前語言為藍色）。兩版在同一個 commit 內一起修改。`backend/tests/test_docs.py`
  檢查成對檔案、切換按鈕、標題數量相同，以及指令／程式碼區塊一字不差（含中文的區塊可以翻譯）。
  `backend/app/llm/system_prompt.md` 是執行時給 LLM 的輸入，不是文件：永遠不拆分、不加裝飾。

## 已知 bug
- 目前沒有

## 已知限制
- 整局分析的判定來自 300 ms 搜尋：快棋對局的分類每次執行會略有差異。
- 準確度是每步準確度的簡單平均（lichess 另外用依波動加權與調和平均），數字會與 lichess 略有不同。
- lichess 匯入由觀看者的瀏覽器連 lichess，需要該裝置能上網；最近的對局只存在該瀏覽器。
- 「上傳整盤到 lichess」建立的是公開的匯入對局，lichess 只保留主線（變化與註解會被移除）；未登入的匯入有 lichess 的頻率限制。
- Engine：只有一個共用的互動 process；兩個分頁分析不同局面時會互相取代對方的搜尋（顯示為 已中斷 +
  重新分析）。Threads/Hash 的選擇會影響整台機器。
- 寬度 390 px 時 chessground 的檔案座標會超出 2 px（原本就有）。
- 題目：暱稱帳號沒有密碼；任何登入者都能回報停用或恢復題目；與答案一樣好的著法只提示「也是好著」並退回（不沿著該著繼續）；
  只有之後挖到或存成的題目有對手上一步（舊題沒有存那一步）；製題每題需數分鐘 engine 時間。
- AI 製題：agent 的提示只檢查是否寫出第一步的著法或格子（不檢查較隱晦的洩題）；agent 設計的局面常需多次嘗試，4 次都不合格
  就略過該題（工作紀錄列出每次原因）。實測（2026-10-08，各 CLI 預設 model）：挑題 agy 244 秒、codex 32 秒、claude 24 秒，三者
  的說明都與資料一致、沒有警告、提示沒有洩題；設計進攻題三者都在 1–3 次內通過（多為悶殺類），設計防守題 codex 與 claude 4 次都
  不合格、agy 第 2 次通過——防守題的標準（威脅 ≥ 0.5、唯一守法）很難憑空設計。agy 每次回答需數分鐘。
- AI 選擇：Codex 一次給出完整回答（思考時沒有逐字顯示）；Claude 的 model 清單是 `--help` 列出的別名
  （CLI 也接受完整 model 名稱，但不會列出）。
- 回答自動檢查只涵蓋著法、評估、將殺與優勢方向（不含棋子位置等其他敘述）；子句中沒提到某方或著法的中文
  將殺說法不檢查。
- Analyzer 會回報王區攻擊者，但沒有加權的壓力分數；開放的斜線只透過閃擊涵蓋；「先手」只以將軍／被迫
  應著表達。「Why」面板只陳述事實（策略性詮釋交給 LLM）。
- LLM：Claude 路徑從未實際執行（沒有 key）；agy 回答約需 30–60 秒（agy 啟動 + 思考；文字接近最後才
  出現）。E2E 使用 LLM_PROVIDER=fake。
- （已解決）間歇性失敗的 engine.spec 是錯誤的測試預期（黑方先走的 FEN 應為 ply 2 而非 1），只在斷言
  於著法落地前執行時才通過。

## 驗證狀態
- `cd backend && uv run pytest -q` → 241 passed（含 judge：將殺算好著、放任將殺回 mate_missed／blunder 與最佳著、整局分析進行中
  仍可判定、不合法 422、已結束 422）（含：上一步存入（挖題、從一條線存成題目）；等價好著不結束不計分、走錯失敗後
  重試不計分；提示 0／1／2 分數；請 AI 解釋未作答 422、產生後存回且第二次不再呼叫 agent、兩人同時請求只呼叫一次；題型 1 題對 10 題
  時仍約各半；停用／恢復與選題排除；列表與紀錄內容）（含：允許清單含 tailnet 範圍時 tailnet 裝置可連、Docker／其他網段與冒用
  X-Forwarded-For 仍 403）（含 `tests/test_puzzle_agent.py`：擷取 JSON、洩題判定、挑題只接受清單內 id
  （不重複）且丟掉洩題的標題與提示、說明的警告被保存、無法使用的回覆退回難度排序；設計模式依序收到「沒有 JSON」「局面不合法：
  too_many_kings」「沒有唯一解」的原因並重試，通過後依 engine 解答（而非設計構想）撰寫文字、寫不出來時保留設計的標題與提示；
  沒有 AI 時設計 422、不合法的選擇 422；舊資料庫補欄位；題目連結、重複新增附編號、工作的 `made`）（含 test_puzzles 檢查同一時間只跑一批製題；含 `tests/test_puzzle_store.py`（Glicko-2 論文範例、儲存、只計分一次）與
  `tests/test_puzzles.py`（真 engine：找出進攻與防守題、接受其他將殺、重做不計分、提示、走錯、進度不符 422、對轟下到結束、手動新增
  與拒絕、背景挖真實對局與製題））（含：真的 uvicorn 伺服器與連線——用戶端中途斷開
  `/api/explain/stream` 後數秒內 CLI 程序被結束；codex 乾淨執行參數；逾時訊息）（含 `tests/test_cli_providers.py`：三個 CLI 以重播真實輸出
  的假執行檔測試——argv、stdin、私有目錄、effort 參數、失敗、未登入、逾時與提早關閉時結束程序；
  `tests/test_llm_catalog.py`：以真實 help／清單文字測試解析、CLI 更新新增／移除 model 時即時重讀、拒絕的
  選擇、拒絕夾帶參數、所選 CLI 經 /api/explain 回答）（含 `tests/test_grounding.py` 中真實評測發現的每個誤報的
  回歸測試；`tests/test_game_scan.py`：只取一方、依時間順序的最嚴重時刻、黑方先走的 root、先回報進度再給出
  有依據的回答、重複請求命中快取、沒有被判錯的著法時由規則回答、不合法序列 422）（含：60 秒分析下候選著搜尋受 ENGINE_MAX_MOVETIME_MS
  限制、退回搜尋的解釋使用 3 條線／預設時間、串流在搜尋啟動中被取消後不留下孤兒搜尋——此測試在修正前
  會逾時）（含 `tests/test_docs.py`：每份文件都有兩種語言、
  切換按鈕、標題數相同、指令區塊一字不差——每項檢查都曾在故意改壞的副本上確認會失敗）（含
  `tests/test_engine_stream.py`：設定驗證、快照逐步
  加深後 done + 重複請求命中快取、依快照 id 取得 insights（running 與最終）、深度上限提早結束、
  Threads/Hash 每次搜尋套用、無限 + 停止 → ok/find 且再次造訪會重新搜尋（不快取）、其他局面會取消
  串流（不快取）、沒有 id 的解釋不會動到互動 engine）（含以假執行檔重播錄下之 agy 輸出測試
  AgyProvider：串流、錯誤結果、未登入、逾時結束、提早關閉時結束）（含 PGN 匯出來回轉換、回答
  grounding）。規則測試（打入、兵的橫列限制、打入將死、吃升變子 → 兵、FEN 來回轉換、易位權）；3 盤
  真實 lichess 對局到達 lichess 的最終 FEN；真實 Fairy-Stockfish：雙方打入將死、白方視角正負號、
  取代競態（確定性重現，已證實沒有修正時會失敗）、崩潰重啟、root_moves、全部 174 個真實 ply 上 FSF
  `d`/`perft 1` == python-chess 的 FEN 與合法著法；analyzer 事實（精確局面 + 每個真實 ply）；insights
  使用與 analyze 相同的 analysis_id；空著威脅；整局分析判定（含將死邊界情況）以及真實對局工作不干擾
  互動分析；LLM context == 棋盤／engine／analyzer、變化與觀看方、prompt injection 邊界、快取鍵、
  候選著流程、SSE 事件、缺 key 時 503、key 永不出現在錯誤中、以模擬 SDK 串流測試拒答／fallback。
  沒有真實的 Claude 呼叫。
- `cd frontend && npx vitest run` → 64 passed（含 lichess 分析網址；含 rating 圖刻度與座標；準確度與摘要、lichess 網址與 ndjson 解析、時限與日期、
  變化提升與設為主線（多層、使用者線延伸到棋譜之後）、最近對局的去重與上限）；`npx tsc -b`、`npm run lint`、`npx vite build` 無誤。
- `cd frontend && npx playwright test` → 56 passed（含 `e2e/review-tools.spec.ts`：lichess 分析連結與翻轉後的黑方視角、上傳先確認、
  取消不送出、攔截的匯入回應開啟新分頁並留下連結、429 顯示原因；載入後自動整局分析與摘要、只看黑方、n 跳到失誤、
  從錯誤中學習（壞著回分類、好著、不加進棋譜、練習時隱藏 engine）；以攔截的 lichess 回應載入對局網址與使用者列表、對局資訊與原局
  連結、最近對局切回；變化設為主線後重新整理仍保留；手機寬度三個分頁不溢出。E2E 預設關閉自動整局分析，需要時由測試打開）（含：解出後 ⏮▶⏭ 從對手上一步之前完整回放、側欄目前步高亮；多步題
  （Philidor 悶殺）解題中 ◀◀▶▶ 前後挪動、在走過的地方走同一步只前進、解出後回放；防守題走錯按 ← 回到原局面再解出不計分；
  對轟結束後 Home／End 回放）（含 `e2e/puzzle-page.spec.ts`：先顯示對手上一步並高亮；選 Codex 請 AI 解釋
  並存回、下一位玩家看到標題與文字提示、解出算半分、回報停用、我的紀錄（列表、圖、各題型）、題庫篩選與恢復；手機寬度分頁不溢出；
  防守題走錯 → 再試一次解出不計分、或看解答）（含 `e2e/puzzle-agent.spec.ts`（假 CLI 依 prompt 回 JSON）：題目頁獨立選
  Codex CLI → 設計進攻題，第一次兩個王被拒、看到原因與重試、通過後依解答撰寫，從工作列出的連結開題，標題、製作的 agent、兩段式
  提示、解出後的說明，「下一題」離開連結；挑題產生題目並顯示 agent 寫的標題；題目測試改用連結開啟指定題）（含 `e2e/puzzles.spec.ts`：貼上 lichess 寫法 FEN 新增題目（含拒絕原因）、
  主題以文字顯示、重新整理後 rating 保留、手機寬度不溢出；用另一個將殺打入解出 → rating 上升、解答、複製
  FEN、lichess 彈出視窗網址、載入復盤頁；防守題的提示與走錯；對轟下到結束；復盤頁存成題目（重複被拒）與挖題）（含：取消慢速的 codex 回答與全局掃描後再提問）（含：從即時清單選 Codex CLI + model + effort，並取得該 CLI
  針對棋盤 FEN 的回答，重新整理後保留；CLI 更新移除所選 model → 提示並改回預設；手機上走棋不再捲動頁面）（含：未分析著法與 +9.9 評估的回答警告、含棋盤 FEN 的
  「AI 看到的資料」、雙方全局掃描且瀏覽時保留）（含：AI 解釋被延遲 4 秒期間仍可送出自由問題與快捷
  問題、連點只送出一次、整次執行 server 沒有 traceback）（storageState 預設 1 秒搜尋；
  `e2e/engine-settings.spec.ts`：線數 1→5、深度上限 15 提早結束、設定持久化 + 恢復預設、無限分析逐步
  加深且事實來自進行中的里程碑、停止 → 最終事實）。真實 backend + 真實 Fairy-Stockfish + vite，
  在 8821/5181 啟動全新 server，LLM_PROVIDER=fake。涵蓋：DOM 棋盤／pocket 與 backend FEN 逐格相同
  （一盤真實對局的全部 83 個 ply）；滑鼠、點擊打入、觸控（點按 + CDP 拖曳）與鍵盤輸入；不合法打入
  回復；升變 → 被吃 → pocket 中為兵；變化／主線保持不變；engine 打入將死（#1/#-1）、打入標記、快速
  瀏覽時 engine 輸出綁定目前局面；why 面板事實來自畫面上的 analysis_id；將死威脅警示與防守；假 LLM
  回答回傳的正是棋盤局面／FEN／變化；遲到的回答不會顯示在其他地方；§55 核心流程；整局分析標註 +
  評估曲線圖；FEN 載入；engine 開關；自動解釋（快速瀏覽 15 ply → 0 次 LLM 請求，停留 → 剛好 1 次）；
  觀看方；重新整理後還原工作階段；PGN 匯出 → 下載 → 重新匯入得到相同的著法樹；回答中被回傳的無依據
  著法會標示為未驗證；在任何 engine 線出現前提問再瀏覽離開，仍會得到來自完整背景搜尋的回答。
- 真實資料交叉驗證：3 盤已結束的 lichess crazyhouse 對局（fixtures）到達 lichess 自己的最終 FEN
  （棋盤、pocket、走子方、易位權）。進行中的 TV 對局不一致只是因為 lichess 會延遲公開進行中對局的
  著法（不是規則問題）。

- Codex 計時（2026-10-07，同一份全局掃描 prompt，gpt-6.1-sol）：個人設定（xhigh、proxy、hooks）104 秒／推理
  2070 token；`--ignore-user-config` 32 秒；最終乾淨參數 32 秒、推理 0 token；回答同樣有依據。探測：exec 模式下
  個人 hooks 沒有注入 caveman 指示；RTK 規則（AGENTS.md）在各模式都會載入。
- 真實 AI CLI（2026-10-07）：即時清單 agy 14 個 model／5 種 effort、codex 7 個 model／6 種 effort、claude
  3 個別名／5 種 effort；各一題真實回答——codex gpt-6.1-sol low（14 秒）、claude sonnet low（8 秒）、agy
  gemini-3.8-flash-low low（18 秒）——皆為中文、引用 engine 數值、0 個警告。
- 真實 LLM 評測（agy gemini-3.8-flash-high，2026-10-07，`scripts/llm_eval.py`，2 × 28 題，每題約 70 秒）：
  第 1 輪 5/28 題有警告，第 2 輪（加嚴 prompt 後）2/28；所有警告都人工檢視：8 個全是檢查規則的誤報（已修正並
  加回歸測試；第 2 輪重新檢查 → 0/28），沒有確認的幻覺；抽查的無警告回答事實正確。真實全局掃描（fixture 第 3
  盤，雙方）只根據被判錯的時刻回答，0 個警告。
- 真實 LLM（agy，2026-10-06）：`cd backend && LLM_PROVIDER=agy SHOW_ANSWERS=1 uv run python
  scripts/llm_smoke.py` → 4/4 PASS（有回答、中文、沒有未驗證著法、切題；白方視角用語正確、防守與
  analyzer 一致）。透過 serve.sh 用瀏覽器測試：串流回答、顯示模型、Qh5 重新分析、0 個未驗證。發現並
  修正：回答引用了 context 欄位名稱；RichText 現在會顯示 `code` 與 --- 分隔線；等待計時。

## 最近成功的指令
- `PORT=8830 ./scripts/serve.sh`（單一 process；瀏覽器冒煙測試：棋盤 + engine 最佳著，0 個 console 錯誤）
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820`
- `cd frontend && npx vite --host 127.0.0.1 --port 5180`
- `cd frontend && npx playwright test`（會自行在 8821/5181 啟動 server）

## 建議的下一個任務
1. 選用：若取得 ANTHROPIC_API_KEY，以 `LLM_PROVIDER=anthropic` 執行 `scripts/llm_smoke.py`，也驗證
   Claude 路徑。
2. 已完成（保留作為參考）：AI 來源選擇。Provider：agy（`agy models` 列出 id；`--effort` 等級從 `agy --help` 解析）、codex
   （`codex debug models` JSON：slug、visibility、supported_reasoning_levels；以 `codex exec --json
   --skip-git-repo-check --ephemeral -s read-only -C <空目錄> -m M -c model_reasoning_effort=E` 執行，回答在
   `item.completed` 的 agent_message，沒有逐字串流）、claude（`claude -p --output-format stream-json
   --include-partial-messages --verbose --system-prompt S --tools "" --no-session-persistence
   --strict-mcp-config --setting-sources "" --model M --effort E`，逐字內容在 stream_event 的
   content_block_delta；model 別名與 effort 等級從 `claude --help` 解析；不能用 `--bare`，它不讀訂閱登入）。
   每次即時列舉、依最新清單驗證請求，儲存的選項消失時改回預設（agy gemini-3.8-flash-high）。
3. 選用：讓多位觀看者共用互動 engine 而不互相取消（例如每位活躍觀看者一個 engine process，以 CPU 數
   為上限）。

task.md 的所有需求都已實作並測試，包括真實 LLM 回答（透過 agy）。
