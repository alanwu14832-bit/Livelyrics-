# Livelyrics — 為樂團打造的舞台歌詞視覺

上傳一首歌，AI 會以「樂團專職舞台視覺設計師」的角度研究歌曲與樂團，設計**主視覺**、每一段的**背景動畫**，以及**歌詞如何跟著主視覺呈現**。演出時，你在自己的電腦上用**控制台**操作（完整資訊、跳歌詞、黑場、覆寫場景），投影機上的**投影視窗**只顯示動畫與歌詞。

- 音訊分析（BPM、節拍、能量、段落、波形）在瀏覽器完成，音檔只存在你的電腦上。
- 歌詞：自動從 [LRCLIB](https://lrclib.net) 找同步歌詞，或貼上 LRC／純文字，再用「對拍」功能自己對時間。
- 設計：有 Claude API 金鑰時由 Claude 上網研究再設計；沒有金鑰時使用內建的**離線設計模式**（依音訊與歌詞結構產生方案），一樣能完整使用。

## 在本機執行

需求：[Node.js](https://nodejs.org) 20.9 以上（建議 22 LTS）、Chrome 或 Edge（投影視窗使用 WebGL）。

```bash
git clone https://github.com/alanwu14832-bit/Livelyrics-.git
cd Livelyrics-
git checkout claude/epic-meitner-e2pdib   # 合併進 main 之前
npm install
npm run dev
```

打開 <http://localhost:3000>。

### 啟用 Claude 研究與設計（選用）

在專案根目錄建立 `.env.local`：

```bash
ANTHROPIC_API_KEY=sk-ant-...
# 選用：換模型（預設 claude-opus-5）
# LIVELYRICS_MODEL=claude-opus-5
# 選用：資料存放位置（預設 ./data）
# LIVELYRICS_DATA_DIR=/path/to/livelyrics-data
```

存檔後在終端機按 `Ctrl+C`，再重新執行 `npm run dev`。首頁右上角會從「離線設計模式」變成「Claude 已連線」。

### 先用示範歌曲試試

`npm run dev` 執行中時，另開一個終端機：

```bash
node scripts/seed-demo.mjs
```

它會用 `fixtures/demo-song.wav` 與 `fixtures/demo-lyrics.lrc` 建立一個示範專案，並印出控制台網址。也可以直接在首頁把 `fixtures/demo-song.wav` 拖進上傳區、貼上 `fixtures/demo-lyrics.lrc` 的內容（這樣會在瀏覽器做完整的音訊分析，時間軸會有波形）。

## 使用流程

1. **首頁**：拖放音檔 → 自動讀取曲名／歌手並分析音訊 → 選歌詞來源（自動搜尋／貼上／之後再說）→「開始製作」。
2. **處理頁**：即時看到研究進度（Claude 的搜尋關鍵字與研究筆記）與設計結果（主視覺、色盤、視覺符號、段落規劃）。
3. **控制台** `/p/<id>`：
   - 左：依段落分組的歌詞，點一下就跳到那一句
   - 中：投影畫面即時預覽，下方是「現在／下一句」大字和下一個操作提示倒數
   - 下：波形時間軸，含段落、歌詞刻度、操作提示；點擊或拖曳可以跳轉
   - 右：設計（主視覺概念、每段設計理由與快速修改）、研究（研究報告與來源）、控制（黑場、場景覆寫、亮度、字級）、同步（偏移、BPM、Tap tempo、麥克風）
   - 「重新設計」：輸入指示（例如「副歌更熱血」「換成冷色調」），AI 會依指示重新設計
4. **投影視窗**：按控制台的「開啟投影視窗」（或按 `O`），把新視窗拖到投影機／LED 螢幕，再在那個視窗**按 `F` 或雙擊**進入全螢幕。滑鼠停 2 秒後游標會自動隱藏。
5. **歌詞編輯器** `/p/<id>/lyrics`：修改歌詞與時間、對拍（播放時按空白鍵標記每一句開始）、±0.1 秒微調、匯出 LRC。

### 兩種播放模式

- **TRACK**：跟著音檔播放，歌詞與畫面依時間自動走（適合放伴奏帶或對時排練）。
- **LIVE**：現場樂團不跟 click 時使用。音檔不播放，由操作員按空白鍵或 `→` 逐句下 cue，畫面跟著切換段落；可開麥克風讓動畫跟著現場音量律動，並用 `T` 打拍子。

### 控制台快捷鍵（按 `?` 可隨時查看）

| 按鍵 | 功能 |
|---|---|
| `Space` | 播放／暫停（LIVE：下一句） |
| `→` `↓` / `←` `↑` | 下一句／上一句 |
| `Enter` | 送出待命的歌詞 |
| `M` | 切換 TRACK／LIVE |
| `B` | 一鍵黑場 |
| `L` | 歌詞顯示／隱藏 |
| `F` | 凍結畫面 |
| `1`–`9` / `0` | 覆寫場景／回到設計方案 |
| `[` `]` | 偏移 ∓0.05 秒（加 Shift：0.01 秒） |
| `T` | Tap tempo |
| `O` | 開啟投影視窗 |

## 演出前檢查

- 演出前先在有網路的環境打開一次投影視窗，字型會被瀏覽器快取；Claude 研究只在製作階段需要網路，演出時完全在本機運作。
- 用 Chrome／Edge，並讓控制台分頁保持在前景（最小化的分頁會被瀏覽器降速）。
- 控制台「控制」分頁可以開啟測試圖與安全區，確認投影比例與字級。

## 開發

```bash
npm run typecheck   # next typegen + tsc
npm run lint
npm test            # vitest
npm run build
```

架構、模組分工與資料契約見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。產品設計依據的業界研究見 [`reports/音樂祭大螢幕歌詞與視覺設計.md`](reports/音樂祭大螢幕歌詞與視覺設計.md)。
