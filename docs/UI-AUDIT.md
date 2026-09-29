# Livelyrics UI 稽核與 Apple 風格重設計規格

> **UI 改版（2026-09 完成）**：本規格已照第 4 節的五個階段實作完畢。已解決 UI-01 到 UI-36 全部 36 項：
> UI-01、UI-02、UI-03、UI-05、UI-06、UI-07、UI-08、UI-09、UI-10、UI-11、UI-12、UI-13、UI-14、UI-15、UI-16、UI-17、UI-18、UI-19、
> UI-20、UI-21、UI-22、UI-23、UI-24、UI-25、UI-26、UI-27、UI-28、UI-29、UI-30、UI-31、UI-32、UI-33、UI-34、UI-36 已在執行中驗證；
> UI-04（SF／PingFang 字體堆疊）與 UI-35（時間軸慣性與邊界回彈）已實作，但 Mac 上的字體顯示與實機手感無法在 Linux headless 驗證。
> 驗收：typecheck、lint、test、build 全部通過；`scripts/e2e.cjs` 34 項（原 29 項加 5 項水平溢出檢查）全部通過；兩種外觀的文字對比掃描 0 項低於 AA。
> 已知例外：設計師（`src/lib/server/designer/normalize.ts`）離線筆記的段落理由仍以 em-dash 連接，設計師模組不在這次 UI 改版範圍內。

> 範圍：`/`（上傳與作品庫）、`/p/[id]/process`、`/p/[id]`（控制台）、`/p/[id]/lyrics`、`/stage-lab` 的外框。
> **不在範圍內**：`/p/[id]/output` 投影視窗、`src/components/stage/**`、`src/lib/stage/**`（舞台渲染與投影的樣子一律不動）。
>
> 依據：`Leonxlnx/taste-skill`（redesign-skill、taste-skill §0/1/2/4/6/8/9/11、minimalist-skill、soft-skill）與
> `emilkowalski/skills`（apple-design、emil-design-eng、review-animations + STANDARDS、improve-animations + AUDIT、
> animation-vocabulary、pick-ui-library）。
>
> 方法：兩位稽核員（視覺、動態與互動）以隔離的 dev server 跑 `scripts/e2e.cjs`（29/29 通過），再用 Playwright 在
> 1440×900 與 1280×800、淺色與深色、減少動態下截圖與量測。設計主導逐條對照原始碼、截圖與對比計算，刪掉錯誤、合併重複、
> 修正行號，並訂出下面的設計方向。截圖在工作階段暫存區
> `/tmp/claude-0/-home-user-Livelyrics-/54af4fb5-fe96-588c-9dc1-811a9f80bc8f/scratchpad/audit-shots/`
> （以下以 `visual/…`、`motion/…` 相對路徑引用，暫存區可能不會長期保留）。

**設計判讀（taste-skill §0.B）**：這是一個本機專業工具的 preserve 模式重設計（taste-skill §11.A），使用者是樂團的舞台視覺操作員。
外觀語言以 apple.com 與 iOS HIG 為準：系統色、inset grouped 列表、分段控制、材質、SF 字體、克制、彈簧動態。控制台則偏向
Final Cut Pro / Logic Pro 那種永遠深色的專業 app。

**旋鈕（taste-skill §1）**：首頁與處理頁 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 4 / VISUAL_DENSITY 3`（apple.com 產品頁是對稱置中的，
所以 VARIANCE 刻意壓在 4 以下，允許置中 hero）。控制台與歌詞編輯器 `2 / 2 / 8`。taste-skill 本身是為 landing page 寫的：
首頁與處理頁完整套用，控制台只套用 §4.5（觸感回饋、對比）、§4.4、§6.A/6.B、§9 與 §11.C。

---

## 1. 總評

資訊架構是這個產品最強的部分，問題幾乎都在它上面那一層視覺系統。控制台的格線（歌詞｜預覽＋現在/下一句｜分頁面板、時間軸、
現場提示）、依段落分組的歌詞、下一個操作的倒數、段落上色的波形時間軸、處理頁的主視覺摘要，都是真正為操作員設計的結構，
應該原封不動保留。

讓它不像 Apple 的主要是四件事：

1. **只有一個顏色在做所有事。**橘紅強調色 #ff5a36 同時代表主要按鈕、處理中、選取、焦點、未儲存與錯誤，和 danger 色相只差 17°，
   而且還另外有一個紫色第二強調色和一條橘紫「AI 漸層」。
2. **字體不是系統字。**UI 用 Noto Sans TC 網頁字型、15 種零散字級、中文小標加 0.12 到 0.18em 正字距，數字全用 Geist Mono。
3. **用邊框畫層級。**153 處 1px 實線，框中有框，沒有材質，也只有深色。
4. **沒有動態系統。**沒有按壓回饋，對話框單幀出現，演出期間有無限循環的 ping/pulse，也沒有任何減少動態、減少透明度或
   增加對比的支援。

另外有一個 P0（新作品卡片溢出 102px）和三個直接影響操作的 P1：控制分頁打開時黑場不在畫面內、歌詞標記拖曳會跳時間、
LIVE 等待時主播放鈕一直閃。

### 分數（1 到 10，10 = 可以直接放在 apple.com 旁邊）

| 面向 | 分數 | 理由 |
|---|---|---|
| 視覺一致性 | 4 | 四個頁面的頂欄高度（64/57/56/57px）、容器寬度、返回方式、「目前列」顏色（橘/紫）、播放鈕形狀都不同；分段控制有五種寫法；「作品庫」與「專案庫」混用。 |
| 字體排印 | 4 | 網頁字型取代系統字；9 到 26px 共 15 種字級，45 處小於 11px；中文加正字距與 uppercase；只有 tabular 時間碼是對的。 |
| 色彩與材質 | 3 | 強調色撞 danger；雙強調色加 AI 漸層與光暈；冷灰面板配暖色；邊框代替層級；沒有材質；只有深色。 |
| 元件與互動 | 5 | 功能完整、角色與鍵盤操作到位，但按鈕約 8 種樣式、對話框 3 套、無按壓回饋、28% 的控制台控制項小於 28px，另有 P0 溢出。 |
| 動態 | 3 | 預設曲線、無權杖、單幀對話框、無限循環裝飾、鍵盤選取用 smooth 捲動。好的一面：時間軸拖曳 1:1、快捷鍵零動畫。 |
| 無障礙 | 5 | role、listbox、aria-activedescendant、原生 dialog、aria-live 都有；但 faint 文字 2.98:1、主按鈕白字 3.10:1、listbox 無焦點指示、完全沒有減少動態、減少透明度、增加對比的處理。 |
| 資訊架構 | 8 | 控制台與處理頁的結構精準對應操作員的工作；扣分在標題區徽章堆疊與重複 CTA。 |

整體約 **4.5 / 10**。好消息是地基很紮實，照 redesign-skill 的 Fix Priority（字體、色彩、狀態、版面、元件、空/載入/錯誤狀態、細節）
做「targeted evolution」（taste-skill §11.E），可以用大約四成的風險拿到七成的效果。

### 已經做對、必須保留（taste-skill §11.C）

**資訊架構**
- 控制台格線區域與比例（`src/components/console/ConsoleApp.tsx:148-186`）：歌詞｜預覽＋現在/下一句｜分頁面板，下方時間軸｜現場提示。
- 依段落分組並帶 colorway 色條的歌詞列表、大字「現在/下一句」、下一個提示的倒數、段落上色的波形時間軸。
- 處理頁的內容模型：選定段落的即時預覽、帶角色名稱的色票、視覺符號、字體樣張、段落條加理由表、設計師筆記、現場操作提示。
- 路由與網址不變（taste-skill §11.F）；品牌標誌（`src/components/home/Brand.tsx`，聚光燈照兩行歌詞）保留為 app icon，
  只是它的漸層不再出現在其他 UI。

**鍵盤與直接操作**
- 完整快捷鍵與 `?` 說明；Space keyup 防護；滑鼠點擊後 blur，避免 Enter/方向鍵重複觸發（`ConsoleApp.tsx:121-136`）；
  重新設計對話框內 B 黑場照樣有效（`RedesignDialog.tsx:69-81`）。
- 快捷鍵反應零動畫（emil-design-eng › Should this animate at all?）。新增的回饋也必須 0ms 出現。
- 時間軸拖曳是教科書等級的直接操作：pointerdown 就跳、`setPointerCapture`、`touch-none`、PageUp/PageDown/Home/End；
  實測 11/11 取樣讀數等於預期時間，拖出畫布外會夾在 73 秒（apple-design §1、§2）。**播放頭永遠不加彈簧或 transition。**
- 自動跟隨在手動捲動時暫停、4 秒後恢復並顯示「回到目前」（`LyricsList.tsx:96-129`）；StreamPanel 只在使用者沒往上捲時黏底；
  SSE 每 120ms 批次更新；對拍按鈕不取得焦點，Space 不會觸發兩次；SectionPreview 只在可見時跑 WebGL。

**效能**
- 每幀的值繞過 React：TimeReadout 寫 textContent、CurrentProgress 用 scaleX、儀表用 scaleX 與 opacity、時間軸只在變更鍵不同時重畫
  （`console/TopBar.tsx:14-34`、`LyricsList.tsx:53-68`、`SyncTab.tsx:14-43`）。重設計時保留這個寫法。

**無障礙結構**
- 大多數控制項有 focus-visible 外框；`role=radiogroup/tablist` 含方向鍵（`SidePanel.tsx:60-68`）；listbox + `aria-activedescendant`；
  具名 dialog；`home/Dialog.tsx` 用原生 `<dialog>`（top layer、焦點圈限、Esc）；主控台對話框關閉後把焦點還回去；now line 與進度有 aria-live。
- 懸停樣式只有顏色，而且 Tailwind v4 已用 `@media (hover: hover)` 把關。

**狀態與文案**
- 錯誤與空狀態具體、可行動、語氣直接：音檔錯誤列的「重新載入音檔／切到 LIVE」、處理頁錯誤、伺服器沒啟動時點名 `npm run dev`。
- 隱私與離線透明度的事實（音訊分析在瀏覽器完成、音檔只存在這台電腦、離線設計模式）。保留事實，只改呈現。
- 控制台骨架依版面形狀（`console/States.tsx:9-40`）與每個面板各自的錯誤邊界（`PanelBoundary`），舞台工具不會整頁空白。

**可直接沿用的元件**
- TRACK/LIVE 分段的「白色 thumb 深色字」已經是 iOS 深色的樣子（`console/controls.tsx:53`）：以它為基礎泛化。
- 歌詞編輯器的白色圓形播放鈕（`lyrics-editor/Transport.tsx:37`）就是 Apple Music / QuickTime 的樣式：控制台也改用它。
- 所有時間碼的 tabular 數字（`.tabular`、`formatTime` 到 1/100 秒）。
- 控制台時間軸已從 CSS 權杖讀色（`console/Timeline.tsx:50-65`）：編輯器時間軸照這個做。

### 設計主導的修正（稽核意見中被刪除或改寫的部分）

1. 「只有首頁頂欄有 blur」不正確：首頁與子頁 TopBar 都有 `backdrop-blur`（`home/HomeClient.tsx:12`、`home/TopBar.tsx:31`），
   不透明的是控制台頂欄。
2. 「刪除確認的內文是空白的」不正確（`visual/lib-1440-dark-delete-dialog.png` 沒有空白內文）。真正的問題是：是非題用了有上下分隔線的 sheet 外框。
3. 視覺稿中控制台檔案的行號（TopBar、ControlTab、Preview、LyricsList）與實際檔案不符，本文件全部改成實際行號。
4. 「作品卡用 motif SVG 當藝術圖」目前做不到：`ProjectSummary`（`src/lib/types.ts:149-162`）只有 `accent` 與 `palette`。
   先用色票做藝術圖；要加 motif 必須擴充共享契約（types.ts + `lib/server/storage.ts` 的摘要），需要協調。
5. 「移除歌名的 `required`」會讓 e2e 壞掉（`scripts/e2e.cjs` 用 `section[aria-label="新作品"] input[required]`）。改成在 form 加 `noValidate`。
6. 「四個側欄面板全部 mount、用 hidden 切換」會讓同步分頁的 rAF 儀表在背景一直跑。改成每個分頁記住自己的捲動位置。
7. 「深色模式主按鈕用 #0a84ff 配白字」只有 3.65:1，不合 AA。改成拆成 tint（非文字）、tint-fill（按鈕底）、tint-text（文字）三個權杖。
8. iOS 淺色 secondaryLabel `rgba(60,60,67,.6)` 在白底只有 3.44:1。淺色次要文字改用 apple.com 的 #6e6e73（5.07:1）。
9. 「每個頂欄都做成半透明材質」不適用控制台：控制台頂欄下面沒有任何內容會捲過去，半透明沒有意義（apple-design §12 只在內容捲到下方時才用材質）。
10. 「歌詞來源標籤改成單行『貼上』」會讓 e2e 壞掉（`hasText: "貼上歌詞"`）。標籤維持「貼上歌詞」。

---

## 2. 問題清單

依嚴重度（P0 壞掉或不能用、P1 明顯不符品牌或傷害可用性、P2 細節），同嚴重度依區域排序。括號內是稽核原始編號（V = 視覺、M = 動態）。

| ID | 區域 | 嚴重度 | 問題（位置） | 依據 | 修正方向 |
|---|---|---|---|---|---|
| UI-01 | 上傳 | P0 | LRCLIB 結果出現後，新作品卡片內容寬 1206px、卡片只有 1104px，右欄被裁切；點「預覽」會讓 `overflow-hidden` 的卡片橫向捲動約 104px，左欄的歌名欄位被切掉。原因：兩個 `<fieldset>` 預設 `min-inline-size: min-content`，結果列的 nowrap/truncate 文字把欄撐寬（`upload/NewProjectCard.tsx:131`、`upload/LyricsOptions.tsx:58`，格線在 `NewProjectCard.tsx:130`）。（V-01） | redesign-skill › Layout、› Rules「Do not break existing functionality」；taste-skill §4.7；apple-design §16.7 Craft | 兩個 fieldset 與 `LyricsSearchPicker.tsx:118` 的根節點加 `min-w-0`；結果列的 label flex 列加 `min-w-0`。e2e 加一條檢查：LRCLIB 結果出現後，`section[aria-label="新作品"]` 必須 `scrollWidth <= clientWidth`。 |
| UI-02 | 全域 | P1 | 強調色 #ff5a36（色相 11°）與 danger #ff4d5e（354°）只差 17°，卻同時代表主要按鈕、處理中、選取、焦點框、未儲存與錯誤；另有第二強調色 #8b6cff 用在編輯器目前列與標記；冷灰面板配暖色強調（`app/globals.css:18-22`、`ui/index.tsx:30,34`、`process/StepTimeline.tsx:50`、`lyrics-editor/LineTable.tsx:84-87`、`LyricsEditorClient.tsx:598`）。（V-03） | taste-skill §4.2（Max 1 accent、COLOR CONSISTENCY LOCK）；redesign-skill › Color and Surfaces；apple-design §16「Feedback comes in four kinds」 | 改用 iOS 系統色語意（§3.1）：systemBlue 是唯一 tint；systemRed 只給黑場、LIVE on-air、錄製、錯誤與刪除；刪除 `--color-accent-2`；「處理中」用 label-2 文字加 Spinner，不用 tint。品牌橘只留在品牌標誌。 |
| UI-03 | 全域 | P1 | 對比不足：`--color-faint` #5b6172 當文字用了約 100 處，在 panel 上 2.98:1、panel-2 上 2.76:1、panel-3 上 2.44:1，承載 10 到 11px 的提示、時間戳、標籤；主按鈕白字在 #ff5a36 上 3.10:1（`globals.css:17`、`console/controls.tsx:11,125`、`ui/index.tsx:30`）。（V-04） | taste-skill §4.5 BUTTON CONTRAST CHECK、FORM CONTRAST CHECK，§8.B；apple-design §12 Vibrancy、§14 | label / label-2 / label-3 分層（§3.1，比值已驗證）：所有可讀文字最低用 label-2；label-3 只給刻度、分隔、停用圖示等非文字；填色按鈕 #0071e3 配白字（4.70:1）；`prefers-contrast: more` 再加強。 |
| UI-04 | 全域 | P1 | 字體：UI 用 Noto Sans TC 網頁字型，不是 SF / PingFang TC 系統字；9、10、10.5、11、11.5、12、13、14、16、18、20、22、24、26px 共 15 種字級，45 處小於 11px；中文小標加 0.12 到 0.18em 正字距與 uppercase；所有數字都用 Geist Mono（`globals.css:24-25`、`lib/fonts.ts:28`、`console/controls.tsx:11`、`console/DesignTab.tsx:69`、`console/Preview.tsx:141,163`、`console/ControlTab.tsx:72`、`console/DesignTab.tsx:109`）。（V-05） | apple-design §15（系統字、字距隨字級、行高反比）；redesign-skill Fix Priority #1、› Typography；taste-skill §4.1、§9.B；minimalist-skill 字體 | 依 §3.2 的字體堆疊與字級表：最小 11px；中文字距 0，禁止正字距與全大寫；時間碼改系統字加 tabular-nums；mono 只給色碼與 LRC 文字框。 |
| UI-05 | 全域 | P1 | 只有深色：模擬 `prefers-color-scheme: light` 的截圖與深色完全相同；沒有宣告 `color-scheme`（捲軸、原生控制項用錯外觀）；多處寫死 hex，換權杖也換不掉（`lyrics-editor/Timeline.tsx:11-24`、`console/Notices.tsx:15-17`、`home/ProjectLibrary.tsx:231`、`upload/Waveform.tsx` 預設色）。（V-06） | taste-skill §6.C、§8.A、§8.D、§4.11；apple-design §16.7（colors that adapt to light/dark） | 非控制台頁面跟隨系統外觀（預設淺色，像 apple.com）；控制台固定深色；語意 CSS 變數加 `@theme inline`（§3.1）；canvas 從自己的元素讀權杖（照 `console/Timeline.tsx:50-65`）。 |
| UI-06 | 全域 | P1 | 材質：153 處 `border-line` 實線、框中有框（控制台 pane 的邊框裡有段落卡邊框，裡面又有選單與 chip 邊框，三層線）；控制台頂欄不透明又有邊框；陰影是通用黑（`ui/index.tsx:43`、`console/ConsoleApp.tsx:148`、`console/DesignTab.tsx:200`、`process/KeyVisualSummary.tsx`、`home/Dialog.tsx:76`）。（V-07） | apple-design §12 Materials & depth；taste-skill §4.4；redesign-skill › Component Patterns「Generic card look」、› Color and Surfaces「Generic box-shadow」 | 用填色層級取代邊框：#000 背景上的 #1c1c1e pane（6px 間隙、圓角 12、無框），pane 內群組列表用 #2c2c2e，列之間用 hairline；只有內容會捲到下面的頂欄才用材質；彈出層用 §3.1 的陰影。 |
| UI-07 | 全域 | P1 | 四個頁面像四個 app：頂欄高度 64/57/56/57px；容器 1152px 置中、1400px、滿版；返回方式有 logo、麵包屑、「‹ 專案庫」三種；「作品庫」與「專案庫」混用（`console/TopBar.tsx:92`、`console/States.tsx:63,84`）；「目前」在控制台是橘色列、在編輯器是紫色列；播放鈕一邊是橘色長方形（`console/TopBar.tsx:103-113`）、一邊是白色圓形。（V-08） | apple-design §16.4 Familiarity、§16「Direct, specific labels」；taste-skill §4.11、§11.B | 共用 `AppHeader`（52px，§3.3）；一律用「作品庫」（首頁既有的主導覽標籤，§11.F）；「目前列」只有一個權杖（3px tint 左條、tint 18% 底、600 字重），控制台、編輯器、時間軸共用；播放鈕統一為白色圓形 36px。 |
| UI-08 | 全域 | P1 | 兩套手繪 SVG 圖示：`home/icons.tsx`（24 格線、線寬 1.8，16px 時約 1.2px）與 `console/icons.tsx`（16 格線、線寬 1.6）；另有 `console/controls.tsx` 的內嵌 chevron 與文字符號 ▾（`ProcessClient.tsx:440`、`ResearchPanel.tsx:31`）、✦（`LyricsList.tsx:299`）、⌫；已安裝的 `@phosphor-icons/react` 完全沒被 import。（V-09） | taste-skill §3.C、§9.E、§3.D；redesign-skill › Iconography；minimalist-skill 圖示 | 全面換成 Phosphor（§3.3 Icon），刪除兩個 icons.tsx；▾ 換成 CaretRight/CaretDown；✦ 改成文字「強調：夜色」。 |
| UI-09 | 全域 | P1 | 分段控制有五種寫法：高度 24/28/32/48px、圓角 5/6/8px、選取樣式各異；側欄四個視圖用底線分頁；歌詞來源分段裡塞了兩行 11px 提示；選取瞬移沒有滑動（`console/controls.tsx:23-62`、`upload/LyricsOptions.tsx:60-74`、`lyrics-editor/ImportDialog.tsx`、`lyrics-editor/Transport.tsx`、`console/SidePanel.tsx:72-98`）。（V-10、M-11） | apple-design §16.4、§4、§7；taste-skill §4.4 SHAPE CONSISTENCY LOCK；review-animations STANDARDS › Easing、› Performance；animation-vocabulary › Layout animation | 只做一個 `SegmentedControl`（§3.3），thumb 用 CSS transform 加 `--ease-spring` 滑動；提示字移到控制項下方的 caption，隨選取更新。 |
| UI-10 | 全域 | P1 | 按鈕系統分裂：`ui/Button` 之外還有約 8 種手刻樣式（`home/ProjectLibrary.tsx:222,271-280`、`console/States.tsx:53`、`process/ProcessClient.tsx` 的 Link 按鈕、`console/SyncTab.tsx` offsetBtn、`console/ResearchTab.tsx`、`lyrics-editor/Transport.tsx`），高度 24 到 44px；停用的主按鈕變成暗橘色像壞掉，還拿標籤當狀態（「所有行都已定時」）；所有可按元素按下時沒有任何回饋（量測 mousedown 後 200ms transform 皆為 none）。（V-14、M-03） | apple-design §1 Response；emil-design-eng › Buttons must feel responsive；review-animations STANDARDS › Physicality、› Asymmetric timing；taste-skill §4.5 Tactile Feedback；redesign-skill Fix Priority #3 | `Button` 加 `href` 模式與五種變體（§3.3）；`:active` scale .97（按下 80ms、放開 160ms）；列表列只做即時底色；停用 = opacity .35、標籤不變，狀態文字移到內文。 |
| UI-11 | 全域 | P1 | 沒有動態權杖：所有 transition 都是 Tailwind 預設的 150ms `cubic-bezier(0.4,0,0.2,1)`，`ease-out`（`UploadFlow.tsx:258`）解析成偏弱的 `cubic-bezier(0,0,0.2,1)`；每個新元件都會各自亂設（`globals.css:9-27`）。（M-01） | review-animations STANDARDS › Easing、› Cohesion；improve-animations AUDIT §2、§7；apple-design §4 | §3.4 的 CSS 權杖（含 `--ease-spring` 臨界阻尼彈簧 `linear()`）與 `src/lib/motion.ts` 的彈簧預設值，全專案只引用權杖。 |
| UI-12 | 全域 | P1 | 完全沒有 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast` 規則（CSSOM 掃描 0 條）；JS `scrollTo({ behavior: "smooth" })` 無視系統設定（`console/LyricsList.tsx:123`、`console/CuePanel.tsx:26`、`LyricsEditorClient.tsx` 對拍跟隨）；半透明表面沒有實色退路。（M-02、V-25） | apple-design §14；taste-skill §6.B（強制）；review-animations Standard 8；improve-animations AUDIT §6 | §3.4 最後的三組媒體查詢；`useReducedMotion()`（motion/react）決定 scroll behavior 與所有 motion 動畫，移動改成 150ms 以內的淡入淡出。 |
| UI-13 | 全域 | P1 | 無限循環裝飾：「投影已連線」綠點 `animate-ping` 整場演出不停（`console/TopBar.tsx:49`，一場約 5000 次擴散）；對拍 ping（`lyrics-editor/TapSyncBar.tsx:73`）；處理中徽章、文字、骨架、游標、圖示共 12 處 `animate-pulse`（`ProcessClient.tsx:230,231,285`、`ProjectLibrary.tsx:129,236`、`StreamPanel.tsx:37,56`、`console/TopBar.tsx:125`、`RedesignDialog.tsx:149`、`console/States.tsx:10,115`、`UploadFlow.tsx:210`、`ServerStatus.tsx:35`）。（M-05、M-15、V-25） | review-animations Standard 1、2；apple-design §14（避免緩慢循環）；taste-skill §0.D、§9.F；emil-design-eng › Perceived performance | 穩定狀態保持靜止：連線用靜態 6px 綠點（由未連線變連線時單次 600ms 光環）；進行中用 Spinner（全站唯一允許的循環）；骨架靜態；對拍用靜態紅點。 |
| UI-14 | 首頁 | P1 | 首頁層級：離線提示是一個三行黃色警告框，而且放在 hero 之上（`home/HomeClient.tsx:19`、`home/ServerStatus.tsx`），但離線是正常支援的模式；h1 只有 24px、副標 14px 且一行約 60 字（`HomeClient.tsx:22-25`）；dropzone 靜止時是 2px 虛線框加 36rem 橘紫 blur-3xl 光暈（`upload/Dropzone.tsx:70,80`）；閒置、分析中、檢視三個階段高度 256/200/800px 跳動。（V-12） | taste-skill §4.7 HERO STACK DISCIPLINE、§9.A、§4.2 LILA RULE、§9.F；apple-design §16.6；redesign-skill › Layout「Missing whitespace」 | apple.com 產品頁節奏：56px hero 標題、21px 副標、dropzone 本身就是 hero 物件（§3.5 首頁）；離線提示改成一行 label-2 文字加「連接 Claude」連結，點開 sheet 看步驟。 |
| UI-15 | 首頁 | P1 | 作品卡：斜線條紋加單一強調色漸層，每個作品看起來都一樣；狀態徽章壓在圖上；一列擠了四個動作，而且「重新處理」（會重新研究並取代設計）緊鄰主按鈕；只有一張卡時三欄格線留下兩個空欄（`home/ProjectLibrary.tsx:217-296`、`:152`）。（V-13） | taste-skill §9.F（不在圖上疊標籤）、§4.5 NO DUPLICATE CTA INTENT；redesign-skill › Component Patterns；apple-design §16.2、§16.6 | Apple Music 式卡片：16:10 色票藝術圖；點整張卡直接進控制台（ready）或處理頁（其他狀態）；次要動作收進 ⋯ 選單；格線 `repeat(auto-fill, minmax(260px, 1fr))`。motif 需擴充 `ProjectSummary`（見第 1 節修正 4）。 |
| UI-16 | 控制台 | P1 | 側欄四個分頁共用一個捲動容器（`console/SidePanel.tsx:100-111`，內容換掉但 `scrollTop` 保留）：在「設計」往下捲再切到「控制」，黑場、歌詞、凍結、測試圖都在可視範圍外（實測：設計 scrollTop 700 後切控制得到 scrollTop 180、黑場磚 top -29）；研究與同步也從文件中段打開。（V-02） | apple-design §16 Wayfinding、§16.6；taste-skill §4.5 | 每個分頁各自記住捲動位置（`useRef<Record<TabId, number>>`，切走時存、切回時還原）；「控制」一律從頂端開啟；「安全控制」四磚改成 sticky 列（material thin 底）。不要同時 mount 四個面板。每個 tabpanel 有自己的 id，對應既有的 `aria-controls`。 |
| UI-17 | 控制台 | P1 | 61 個可互動元素中有 17 個小於 28px：段落時間跳轉按鈕 66×19（`console/DesignTab.tsx:216-223`）、滑桿高 6px（`console/controls.tsx:122`）、時間軸縮放 24×24（`console/Timeline.tsx:335-353`）、「編輯歌詞」高 24px（`console/LyricsList.tsx:193`）、「設計說明」展開列 17px（`DesignTab.tsx:164-176`）、滑桿「重設」10px 字（`controls.tsx:104`）。暗場加觸控板，滑桿誤點會直接改到台上的亮度或字級。（V-11） | apple-design §10（hit padding）、§16.5 Flexibility；redesign-skill › Interactivity and States | 所有控制項最小 28×28，視覺必須小的用偽元素擴大點擊區（`relative before:absolute before:-inset-1.5`）；滑桿點擊高度 28px；縮放改成 28px 分段 [−][全曲][+]；展開列整列可點、高 32px。 |
| UI-18 | 控制台 | P1 | LIVE「等待下一句」時主播放鈕無限 pulse（`console/TopBar.tsx:165`）：頂欄最亮的控制項整段主歌都在 100% 與 50% 之間閃，低谷時看起來像停用；而且這時下一步是「送出下一句」（Space / →），不是播放。（M-04） | review-animations Standard 1、2、STANDARDS › Should it animate?；apple-design §14、§16.6 | 移除 pulse。「下一句」按鈕加 2px 橘色環與填色；頂欄出現狀態膠囊「等待下一句」（橘 18% 底、橘字、靜態 HandPalm 12px），0ms 出現，150ms 淡出。 |
| UI-19 | 控制台 | P1 | 快捷鍵回饋又小又散：按 B（最關鍵的安全鍵）頂欄沒有任何變化，只有預覽角落 11px「黑場中」、2px 紅框、控制分頁上 6px 紅點；[ ] 偏移只出現在 10px faint 文字；T 只有打開同步分頁才看得到；1-9 只有角落 chip（`console/Preview.tsx:40-64`、`console/SidePanel.tsx:118-124`、`console/TopBar.tsx:119-142`）。（M-06） | apple-design §16 四種回饋、Grouping & mapping、§13 Causality；emil-design-eng › Animation Decision Framework（鍵盤動作不做進場動畫） | 頂欄常駐狀態膠囊（黑場、凍結、歌詞隱藏、場景覆寫）加上預覽下三分之一的 HUD（macOS 音量 HUD 的樣子）：0ms 出現、停 900ms、250ms 淡出；細節見 §3.5 控制台。 |
| UI-20 | 歌詞編輯器 | P1 | 拖曳時間標記忽略抓取偏移：在標記右側 5px 按下、移動 1px、放開，該行從 0:16.00 變成 0:16.31（全曲視圖 0.052 秒/px）；沒有拖曳門檻，想點標記也可能改到時間（`lyrics-editor/Timeline.tsx:26,228-256`、`LyricsEditorClient.tsx:303-313`）。這個工具的精度要求是 ±0.01 秒。（M-09） | apple-design §2（respect the offset from where they grabbed it）、§10（hysteresis）；review-animations STANDARDS › Gestures & drag；emil-design-eng › Gesture and Drag Interactions | pointerdown 時記下 `grabOffset = timeAt(x) - line.start` 與起點 x；移動 ≥3px 才進入拖曳，否則視為點選；移動時 `start = timeAt(x) - grabOffset`；按住 Alt 精細拖曳（0.25 倍）；拖曳中在標記上方顯示時間氣泡；全程 1:1，無彈簧、無緩動、無吸附動畫。 |
| UI-21 | 對話框 | P1 | 三套實作：原生 `<dialog>`（`home/Dialog.tsx`）與兩個手刻 fixed div（`console/RedesignDialog.tsx:69`、`console/HelpOverlay.tsx:17`，沒有 top layer 焦點圈限）；全部單幀出現、單幀消失；`Dialog.tsx:81` 用 `{open && …}` 包內容，關閉時不可能做退場；控制台兩個 scrim 用 `backdrop-blur-sm` 疊在持續渲染的 WebGL 預覽上，GPU 每幀重新模糊整個畫面；刪除、重新處理、自動分配這種是非題也用帶上下分隔線的 sheet 外框。（V-15、M-07、M-08） | apple-design §12（Dim to focus、Materialize）、§3、§7、§16.2；review-animations STANDARDS › Duration、› Physicality、› Interruptibility；emil-design-eng › Animate enter states with @starting-style；redesign-skill › Modals for everything | 統一用原生 `<dialog>`，分 Alert 與 Sheet 兩型（§3.3）；CSS `@starting-style` 進場，內容保持掛載直到退場結束；scrim 純色不模糊；Help（用 ? 打開）瞬間開關；保留 RedesignDialog 內的 B 黑場直通。 |
| UI-22 | 全域 | P2 | 品牌的橘到紫漸層與光暈滲進 UI：分析進度條（`upload/UploadFlow.tsx:258`）、能量等儀表（`process/KeyVisualSummary.tsx:214`）、dropzone 光暈（`Dropzone.tsx:80`）、對拍列背景（`TapSyncBar.tsx:69`）、執行中步驟光暈（`StepTimeline.tsx:50`）、主視覺符號 drop-shadow 光暈（`DesignTab.tsx:78`）、連線點光暈。（V-16） | taste-skill §4.2 LILA RULE、§9.A；redesign-skill › Color and Surfaces（AI gradient）；minimalist-skill（不用漸層與霓虹） | 漸層只留在品牌標誌；進度條是純 tint；移除所有光暈；對拍列改成平面紅色 12% 帶加靜態紅點。 |
| UI-23 | 全域 | P2 | 文案上的 LLM 痕跡：畫面上的 em-dash 字元（`KeyVisualSummary.tsx:152`、`UploadFlow.tsx:215`、`LyricsSearchPicker.tsx:35,155,233`、`HelpOverlay.tsx:58` 的雙破折號、`Preview.tsx:159,165`、頁面標題 `app/layout.tsx:6`、`ConsoleApp.tsx:42`、`app/p/[id]/process/page.tsx:14`、`app/p/[id]/lyrics/page.tsx:13`）；一行最多四個「·」（`console/TopBar.tsx:134-141`）；中英雙語大寫 eyebrow「主視覺 KEY VISUAL」（`DesignTab.tsx:69-70`）；✦ 符號；段落名稱等於種類時「前奏 前奏」印兩次。（V-17） | taste-skill §9.G EM-DASH BAN、§9.F（middle-dot rationed）、§4.7 EYEBROW RESTRAINT、§3.D；redesign-skill › Typography | 依 §3.6 文案替換表；每行最多一個「・」；空狀態「前奏（無歌詞）」；頁面標題「示範之歌｜控制台」。 |
| UI-24 | 全域 | P2 | 鍵盤焦點與捲動：歌詞 listbox 設了 `focus-visible:outline-none`（`console/LyricsList.tsx:219`），Tab 進去看不到任何指示；Tailwind v4 的 `transition-colors` 包含 outline-color，每次 Tab 焦點框都淡入 150ms（量到中間色 rgb(19,15,17)）；鍵盤 ↑↓ 選取與對拍 Space 會觸發 smooth 捲動（`LyricsList.tsx:131-133`，12 次方向鍵量到 3 次 smooth）。（V-24、M-14） | emil-design-eng › Never animate keyboard-initiated actions；review-animations Standard 2；redesign-skill › Missing focus ring；taste-skill §11.C | 全域 `:focus-visible` 2px tint、offset 2px、不過渡 outline（transition 只列 color、background-color、box-shadow、transform）；listbox 聚焦時在 active option 畫 2px 內嵌 tint 環，沒有選取時自動選目前列；鍵盤選取用 `behavior: "auto"`，只有播放中自動跟隨與滑鼠跳轉用 smooth。 |
| UI-25 | 全域 | P2 | 快捷鍵提示都放在原生 `title` 工具提示（`console/TopBar.tsx` 各按鈕、`ControlTab.tsx`、`CuePanel.tsx`、`DesignTab.tsx:220`）：每次都要等 OS 延遲，樣式不跟深色 UI。時間軸上自製的 cue 提示（`Timeline.tsx:385-402`）是對的。（M-21） | emil-design-eng › Tooltips: skip delay on subsequent hovers；review-animations STANDARDS › Duration、› Physicality | `Tooltip` 元件：第一次 400ms 延遲，前一個關閉後 600ms 內再 hover 立即顯示且無動畫；內容是標籤加 Kbd；拖曳中與對話框開啟時不顯示。 |
| UI-26 | 全域 | P2 | 罕見的重要時刻沒有連續性：設計完成時步驟點、成功橫幅、整個主視覺摘要一次跳出（`process/StepTimeline.tsx:33-69`、`ProcessClient.tsx:352-366`）；刪除作品後其他卡片瞬移（`ProjectLibrary.tsx:151-159`）；首頁卡片到處理頁沒有空間連結。（M-18、M-19、M-22） | review-animations STANDARDS › Should it animate?（罕見時刻可以加 delight）、› Stagger；improve-animations AUDIT §8；taste-skill §5.D | 只在首頁與處理頁：勾勾 200ms 進場、橫幅 250ms、摘要 40ms stagger（最多 12 項，只在剛完成的那一次）；作品格線 `AnimatePresence` 加 `layout`；ViewTransition 為選用，控制台與投影排除。 |
| UI-27 | 首頁 | P2 | 空狀態是模板化的三張等寬卡片「01/02/03」包在虛線框裡（`home/ProjectLibrary.tsx:298-325`），重複上方 dropzone 的呼籲；載入骨架固定三張 h-52 然後縮成實際數量（版面位移）；處理頁骨架是兩塊沒有形狀的板（`ProcessClient.tsx:230-231`）。（V-23） | taste-skill §9.C、§9.F（generic step labels）、§4.5、§6.D CLS；redesign-skill › No empty states | 單一置中的空狀態（§3.3 Empty state）；骨架形狀對應最終版面、延遲 300ms 才出現、靜態不 pulse。 |
| UI-28 | 上傳 | P2 | 表單像網頁表單：LRCLIB 結果是帶框卡片、原生 radio、橘框選取、巢狀原生 checkbox（`upload/LyricsSearchPicker.tsx:178-258`）；歌名有 `required`，瀏覽器原生泡泡會先擋下送出，元件自己的錯誤「請填寫歌名（研究與歌詞搜尋都需要它）。」永遠不會出現（`NewProjectCard.tsx:86-90,146`）；必填用橘色星號（`:135`）。（V-19） | apple-design §16（validate inline）；taste-skill §4.6；redesign-skill › No error states | 結果改成 inset grouped list，選取用右側 Check 配件（原生 radio 保留但視覺隱藏）；「使用 LRCLIB 的時間碼」改 Switch 列；form 加 `noValidate`（保留 `required`，e2e 依賴 `input[required]`），錯誤顯示在欄位下方 12px 紅字，欄位加紅色環；刪除橘色星號。 |
| UI-29 | 上傳 | P2 | 上傳流程動態：dropzone 用 `transition-all`（`upload/Dropzone.tsx:70`）；拖入時圖示 `scale-110` 用弱曲線，Upload 與 Music 圖示單幀替換（`:85-91`）；分析進度條動畫的是 `width`（`UploadFlow.tsx:258`）；分析面板換成新作品卡片是單幀切換。（M-16、M-17） | review-animations 升級觸發（`transition: all`、layout 屬性）、Standard 7；emil-design-eng › Use blur to mask imperfect transitions | transition 列出具體屬性；拖入時圖示 translateY(-2px) scale(1.06)（spring 預設）；兩個圖示疊在同一格交叉淡化加 blur(2px) 150ms；進度改 `transform: scaleX()` 加 240ms linear；階段切換用 opacity 加 translateY(8px) 彈簧。 |
| UI-30 | 處理頁 | P2 | 執行中的標題徽章與步驟點發出和錯誤幾乎一樣的橘紅光（`ProcessClient.tsx:285`、`StepTimeline.tsx:50` 對照錯誤點 `:56`），最焦慮的畫面出現假警報；摘要用了儀表板語彙：有底軌的漸層計分條（能量、速度、密度、音樂反應）、一排關鍵字膠囊、三個帶框小磚（`KeyVisualSummary.tsx:86-93,205-218,234-248`）。（V-22） | taste-skill §9.F（scoring bars with filled tracks）、§4.2、§4.4；apple-design §16 四種回饋 | 執行中 = Spinner 加 label-2「進行中」；完成 = 綠色 Check；錯誤 = 紅色 WarningCircle；儀表改四欄數值列（20/600 tabular 數值加 12px 標籤，可選 3px 無底軌短條）；關鍵字改一行用「、」連接；三個小磚改一個 inset 群組三列。 |
| UI-31 | 處理頁 | P2 | `<details>` 展開時內容瞬移，▾ 文字符號轉 180°，不是 Apple 的 › 轉 90°（`ProcessClient.tsx:434-452`、`ResearchPanel.tsx:19-33`、`KeyVisualSummary.tsx` 段落理由表）。（M-20） | apple-design §16.4（尊重平台隱喻）；review-animations STANDARDS › Performance（不動畫 height）；animation-vocabulary › Accordion | Phosphor CaretRight 12px bold，開啟時 rotate(90deg) 200ms `--ease-out`；內容 opacity 加 translateY(-4px) 200ms（`@starting-style`）；處理頁可用 `interpolate-size: allow-keywords` 動畫高度，控制台禁用。 |
| UI-32 | 控制台 | P2 | 重複與雜訊：段落名稱等於種類時印兩次（`LyricsList.tsx:240-241`、`DesignTab.tsx:209-210`、預覽讀數）；標題區最多 7 個等重徽章（`console/TopBar.tsx:106-145`），真正要注意的「另一個控制台也在控制」「儲存失敗」反而不突出；投影狀態膠囊與「開啟投影視窗」按鈕是同一個動作（`TopBar.tsx:205-209`）；處理頁完成時頂欄與橫幅各有一個「進入控制台」。（V-18） | taste-skill §4.5 NO DUPLICATE CTA INTENT、§9.F；apple-design §16.1 Purpose、§16.6 | 只有 `SECTION_KIND_LABELS[kind] !== label` 時才顯示種類；資訊性狀態移到標題下一行 12px label-2（例如「離線設計・歌詞已對時」）；警報改成紅字按鈕；投影合併成一個分割控制（狀態區段加「開啟」），按鈕保留可及名稱「開啟投影視窗」（e2e 依賴）；處理頁頂欄那顆改 plain。 |
| UI-33 | 控制台 | P2 | 原生 range 與 checkbox（`console/controls.tsx:112-123`、`TapSyncBar.tsx` 反應補償、`SyncTab.tsx` 音量、`LyricsEditorClient.tsx:643`）；麥克風用「啟用」「關閉」兩顆按鈕；鎖定磚有四種色調，綠色代表「測試圖開啟」（`controls.tsx:194-211`、`ControlTab.tsx:37-40`）；「目前段落」用 9px 綠字加一個需要圖例說明的綠框（`ControlTab.tsx:72,134`）。（V-20） | apple-design §1、§2、§16 Grouping & mapping（需要說明的控制項表示對應太弱）；taste-skill §4.2 | iOS Slider 與 Switch（§3.3）；鎖定磚：關 = fill，開 = 黑場實心紅、其他 tint 18%；移除綠色調；目前段落改成 Check 圖示加 12px label-2「目前段落」，刪除圖例。 |
| UI-34 | 控制台 | P2 | 通知與 toast 單幀出現、4.5 秒（錯誤 9 秒）後直接消失，多個通知時其他項目瞬移；滑鼠停在通知上或分頁隱藏時計時照跑（`console/Notices.tsx`、`lib/console/controller.ts` 的 `NOTICE_MS`、`LyricsEditorClient.tsx` 頁尾 toast）。（M-10） | emil-design-eng › The Sonner Principles、› Use CSS transitions over keyframes；apple-design §7；review-animations STANDARDS › Interruptibility | Sonner 式 transition 堆疊（每一項自己設 transform，不用父層變數）；hover、focus-within、`document.hidden` 時暫停計時；iOS banner 外觀（§3.3 Toast）。 |
| UI-35 | 控制台 | P2 | 時間軸縮放與跟隨播放頭瞬移：+、−、全曲、ctrl+滾輪都是一幀換視窗；放大播放時播放頭到 85% 就整頁跳（`console/Timeline.tsx:146-185,276`、`lib/console/timeline-geom.ts` 的 `followPlayhead`）；拖曳時懸停時間標籤被隱藏（`Timeline.tsx:377`），只能看遠處的頂欄時鐘。（M-12、M-13） | apple-design §3、§4、§1（feedback must be continuous）、§16.6（scrubber 顯示時間） | 視窗 span 用 motion 的 `animate()` 彈簧，每次滾輪重定向（可中斷）；播放中連續捲動，播放頭固定在 35%；拖曳時在播放頭上方顯示時間氣泡（時間加該句前 16 字），即時、無動畫。 |
| UI-36 | 歌詞編輯器 | P2 | 每列 7 個 12 到 14px 圖示按鈕，未 hover 時 40% 透明（`lyrics-editor/LineTable.tsx:140-163`），十字準星、目標、插入、剪刀、合併難以辨識；「未儲存」用強調色徽章像錯誤（`LyricsEditorClient.tsx:598`）；停用的「儲存」是暗橘色；對拍說明是一整句加 4 個 Kbd，和表頭搶位置（`TapSyncBar.tsx`）。（V-21） | apple-design §16.6（常用路徑優先，進階選項放下一層）、§16 Grouping & mapping；taste-skill §3.C | 列內只留「從這行播放」「從這行開始對拍」，其餘收進 ⋯ 選單（所有快捷鍵保留）；工具列改成 macOS 工具列；「尚未儲存」12px label-2 在標題旁；對拍改成專注模式（§3.5）。 |

**統計**：P0 1 項、P1 20 項、P2 15 項，共 36 項。

### 證據索引

| ID | 截圖或量測 |
|---|---|
| UI-01 | `visual/home-1440-dark-newproject-auto-full.png`、`visual/home-1440-dark-newproject-auto-preview.png`；DOM：`{cardW:1104, cardSW:1206, fieldsets:[483, 679], minInline:"min-content"}` |
| UI-02 | `visual/process-running.png` 對照 `visual/process-error.png`；`visual/home-1440-dark-newproject-validation.png`；`visual/editor-1440-dirty.png`；`visual/console-1440-redesign-running.png` |
| UI-03 | 計算：faint/panel 2.98、faint/panel-2 2.76、白/accent 3.10、muted/panel 5.99；`visual/console-1440-tab-同步.png`、`visual/zoom-console-lyrics.png` |
| UI-04 | 計算樣式：h1 14px/600 無字距；SectionTitle 11px/600 字距 1.32px uppercase；載入字型 Noto Sans TC、Space Grotesk、Geist Mono；`visual/zoom-console-topbar.png`、`visual/console-1440-tab-控制.png` |
| UI-05 | `visual/home-1440-light-idle.png` 與 `visual/home-1440-dark-idle.png` 相同；`visual/lib-1440-light.png` 與 `visual/lib-1440-dark.png` 相同 |
| UI-06 | `visual/console-1440-design.png`、`visual/zoom-console-readout.png`、`visual/process-done-1440-full.png` |
| UI-07 | `visual/lib-1440-dark.png`、`visual/process-done-1440.png`、`visual/console-1440-design.png`、`visual/console-notfound.png`、`visual/editor-1440.png`、`visual/console-1440-playing.png` |
| UI-08 | `visual/editor-1440-row-hover.png`、`visual/zoom-console-lyrics.png` |
| UI-09 | `visual/zoom-console-topbar.png`、`visual/home-1440-dark-newproject-auto.png`、`visual/editor-1440-import-paste.png`、`motion/console-tab-control.png`；探針 `trans:console-tab-underline {dur:"0s"}` |
| UI-10 | `visual/editor-1440-distribute.png`、`visual/editor-1440-import-paste.png`、`visual/lib-1440-dark-reprocess-dialog.png`；`motion/report.json` 的 `press:*` |
| UI-11 | `motion/report.json`：`easeOutToken="cubic-bezier(0, 0, 0.2, 1)"`、`customEase=[]` |
| UI-12 | `motion/report.json`：`{reducedMotionRules:0, reducedTransparencyRules:0, contrastRules:0}` |
| UI-13 | `motion/console-output-pill.png`、`motion/lyrics-tapsync.png`；`motion/report2.json` 的 `upload:review-anims`、`process:running-anims` |
| UI-14 | `visual/home-1440-dark-idle-full.png`、`visual/home-1440-dark-dragover.png`、`visual/home-1440-dark-analysing.png` |
| UI-15 | `visual/zoom-home-card.png`、`visual/lib-1440-dark.png`、`visual/lib-1440-dark-card-hover.png` |
| UI-16 | `visual/console-1440-tab-control-after-design-scroll.png`；量測 `{scrollTop:180, blackoutVisible:false, tileTop:-29, panelTop:105}` |
| UI-17 | Playwright 量測：`編輯歌詞 72×24`、`設計說明 320×17`、段落時間 `66×19`×6、`INPUT[range] 145×6`×6、縮放 `24×24` |
| UI-18 | `motion/console-live-held-top.png`、`motion/console-live-held.png`；`console:live-held-anims = pulse 2000ms ×Infinity` |
| UI-19 | `motion/console-B-next-frame.png`、`motion/console-B-preview-next-frame.png`、`motion/console-LF-preview-next-frame.png` |
| UI-20 | `motion/lyrics-marker-grab-jump.png`；0:16.00 變 0:16.31（canvas 1400px、0.0521 秒/px） |
| UI-21 | `visual/lib-1440-dark-delete-dialog.png`、`visual/console-1440-redesign.png`、`visual/console-1440-help.png`、`motion/home-delete-dialog-16ms.png`；`console:help-open-next-frame {scrimBackdrop:"blur(8px)"}` |
| UI-22 到 UI-36 | 分別見 `visual/home-1440-dark-analysing.png`、`visual/zoom-console-readout.png`、`visual/zoom-console-focus2.png`、`motion/console-1440-idle.png`、`motion/process-done-after-rerun.png`、`visual/home-loading.png`、`visual/process-loading.png`、`visual/home-1440-dark-newproject-validation.png`、`motion/home-dropzone-drag-40ms.png`、`motion/upload-analyzing.png`、`visual/process-done-1440-full.png`、`motion/process-1440.png`、`visual/zoom-console-topbar-right.png`、`visual/console-1440-tab-同步-scrolled.png`、`motion/console-M-notice.png`、`motion/console-timeline-mid-drag.png`、`visual/editor-1440-row-hover.png`、`visual/editor-1440-tapsync.png` |

---

## 3. 設計方向（實作者照這一節做）

### 3.0 五條原則

1. **顏色來自內容，不來自外框。**UI 本身是中性灰階加一個系統藍；色彩留給樂團的主視覺（色票、預覽、段落條）。
2. **用填色與間距分層，不用線。**背景、表面、群組三層填色；列與列之間才用 hairline。
3. **每個顏色只有一個意思。**藍 = 可操作與選取；紅 = 黑場、on-air、錄製、錯誤、刪除；橘 = 警告與等待；綠 = 已連線、完成、開關打開。
4. **系統字、系統節奏。**SF / PingFang TC，Apple 的字級表，中文不加字距。
5. **回饋在同一幀開始，位置變化用彈簧連續完成（Apple motion，見 3.4.1）。**按下立刻有反應；快捷鍵的狀態同一幀生效；穩定狀態不動；彈簧預設不回彈、可中斷、帶速度；空間轉場（頁面、共享元素、sheet）要有連續感。

### 3.1 外觀與色彩

**外觀模型**

- 首頁、處理頁、歌詞編輯器：跟隨系統外觀，預設淺色（像 apple.com），`prefers-color-scheme: dark` 時用深色。
  歌詞編輯器可在工具列加一個「外觀」選單（系統／淺色／深色，存在 localStorage，寫到根元素的 `data-theme`），
  因為彩排時可能在暗處用。不要做太陽月亮開關（redesign-skill › Component Patterns）。
- 控制台：永遠深色（Final Cut Pro / Logic Pro 式），在 `ConsoleApp` 的根元素加 `data-theme="console"`。根元素在 SSR 時就輸出，
  不會先閃一下淺色。骨架、NotReady、找不到專案三個狀態也要在同一個根元素裡。
- `console/Timeline.tsx:50-51` 的 `readPalette` 目前從 `document.documentElement` 讀變數，必須改成從畫布元素本身讀
  `getComputedStyle(el)`，否則讀到的是淺色值。編輯器時間軸比照辦理。
- 投影視窗與 `/stage-lab`：`OutputClient` 的根元素已是 `bg-black`，`body` 的 `bg-bg` 在淺色時會變成 #f5f5f7（被蓋住，看不到）。
  驗收時比對投影截圖在兩種外觀下完全相同；若任何情況看得到，唯一允許的修改是在 `OutputClient` 根元素加 `data-theme="dark"`。
  `/stage-lab` 的外框固定 `data-theme="dark"`（它是在看舞台視覺）。
- 所有範圍都宣告 `color-scheme`，讓捲軸、原生選單、日期與數字 UI 用對的外觀。

**強調色決定**

- **systemBlue 是唯一的 tint**：主要按鈕、連結、選取、焦點環、目前播放列、滑桿與進度的填充。理由：藍色在 Apple 系統中就是
  「可以按」；而這個產品需要把紅色留給黑場與 on-air，把橘色留給警告，現在的橘紅強調色三者都撞。
- **systemRed 只做語意**：黑場、LIVE 的 on-air 點、對拍錄製、錯誤、刪除。
- **品牌橘不保留為 UI 色**。它只活在品牌標誌（app icon，taste-skill §11.F 不動 logo）。
- 綠色只用在點與圖示（淺色模式的 #34c759 在白底只有 2.22:1，不能當文字，也不能當唯一的圖示色：淺色的綠色圖示用 #248a3d）。

**權杖（CSS custom properties，精確值）**

下面是 `src/app/globals.css` 的目標內容。所有文字配對都用 WCAG 公式算過（見本節末的對比表）。

```css
@import "tailwindcss";

/* ---------- 淺色（預設，apple.com） ---------- */
:root {
  color-scheme: light;

  /* 背景與表面 */
  --bg: #f5f5f7;                 /* 頁面 */
  --surface: #ffffff;            /* 群組列表、卡片、sheet */
  --surface-2: #fbfbfd;          /* 群組內的次層：輸入框、巢狀區塊 */
  --surface-3: #f2f2f7;          /* 第三層：表頭、選取中的列底 */
  --elevated: #ffffff;           /* popover、menu、toast、alert 的底 */

  /* 文字（label 階層） */
  --label: #1d1d1f;              /* 16.83:1 on #fff */
  --label-2: #6e6e73;            /* 5.07:1 on #fff、4.66:1 on --bg；所有可讀的次要文字、placeholder */
  --label-3: rgba(60, 60, 67, 0.30);   /* 只給非文字：刻度、停用圖示、裝飾分隔 */
  --label-4: rgba(60, 60, 67, 0.18);
  --label-2-on-material: #515154;      /* 材質上的次要文字，最壞情況 4.93:1 */

  /* 填色（iOS systemFill 階梯） */
  --fill: rgba(120, 120, 128, 0.20);
  --fill-2: rgba(120, 120, 128, 0.16);
  --fill-3: rgba(118, 118, 128, 0.12);
  --fill-4: rgba(116, 116, 128, 0.08);

  /* 分隔線 */
  --separator: rgba(60, 60, 67, 0.29);
  --separator-opaque: #c6c6c8;
  --hairline: 1px;

  /* Tint（systemBlue） */
  --tint: #0071e3;               /* 非文字：焦點環、選取條、進度、滑桿填充；4.31:1 on --bg */
  --tint-fill: #0071e3;          /* 填色按鈕底，白字 4.70:1 */
  --tint-fill-hover: #0077ed;
  --tint-text: #0066cc;          /* 連結、plain 與 tinted 按鈕文字；5.57:1 on #fff、4.72:1 on --tint-soft */
  --tint-text-on-soft: #0066cc;
  --tint-soft: rgba(0, 113, 227, 0.12);   /* tinted 按鈕、選取列底 */
  --on-tint: #ffffff;

  /* 語意色 */
  --red: #ff3b30;                /* 點、圖示 */
  --red-text: #d70015;           /* 5.38:1 on #fff */
  --red-fill: #d70015;           /* 實心紅底配白字 5.38:1 */
  --red-soft: rgba(255, 59, 48, 0.12);
  --orange: #ff9500;
  --orange-text: #c93400;        /* 5.28:1 on #fff */
  --orange-soft: rgba(255, 149, 0, 0.14);
  --yellow: #ffcc00;
  --green: #248a3d;              /* 圖示與點；綠色不當小字 */
  --green-switch: #34c759;       /* 開關打開的軌道 */

  /* 焦點 */
  --focus-ring: var(--tint);

  /* 材質（背景 + backdrop-filter） */
  --material-thin: rgba(255, 255, 255, 0.60);
  --material-regular: rgba(255, 255, 255, 0.80);   /* apple.com 全域導覽列 */
  --material-thick: rgba(250, 250, 252, 0.92);
  --blur-thin: saturate(180%) blur(16px);
  --blur-regular: saturate(180%) blur(20px);
  --blur-thick: saturate(180%) blur(30px);
  --scrim: rgba(0, 0, 0, 0.30);

  /* 陰影 */
  --shadow-card: none;           /* 淺色 grouped 不用陰影，靠 --bg 與 --surface 的差 */
  --shadow-lift: 0 8px 24px rgba(0, 0, 0, 0.12);                       /* 作品卡 hover */
  --shadow-overlay: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 40px rgba(0, 0, 0, 0.12);  /* menu、popover、toast */
  --shadow-sheet: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 24px 80px rgba(0, 0, 0, 0.18);    /* sheet、alert */
  --shadow-thumb: 0 3px 8px rgba(0, 0, 0, 0.12), 0 3px 1px rgba(0, 0, 0, 0.04);        /* 分段 thumb、開關鈕、滑桿鈕 */
  --segment-thumb: #ffffff;

  /* 圓角（依元件大小，連續圓角感） */
  --radius-xs: 6px;    /* tag、kbd、menu item、分段 thumb（8 - 2 內距） */
  --radius-sm: 8px;    /* 按鈕 sm/md、輸入框、分段容器、小磚 */
  --radius-md: 10px;   /* 控制台內的群組、menu、popover */
  --radius-lg: 12px;   /* 頁面的 inset grouped、控制台 pane、卡片 */
  --radius-xl: 14px;   /* alert、toast、HUD、作品卡藝術圖 */
  --radius-2xl: 20px;  /* sheet、新作品卡片、主視覺展示磚 */
  --radius-3xl: 28px;  /* 首頁 dropzone hero 磚 */
  --radius-pill: 980px;/* apple.com 膠囊 CTA、狀態膠囊 */

  /* 間距（4px 格線） */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px; --space-20: 80px;
  --page-gutter: 24px;           /* 首頁、處理頁、編輯器左右 */
  --group-gap: 24px;             /* 群組之間 */
  --row-min-h: 44px;             /* inset grouped 列 */
  --row-pad-x: 16px;
}

@media (min-resolution: 2dppx) {
  :root { --hairline: 0.5px; }
}

/* ---------- 深色（非控制台頁面跟隨系統；兩個區塊內容相同） ---------- */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 與下方 [data-theme="dark"] 同值 */ }
}
[data-theme="dark"],
[data-theme="console"] {
  color-scheme: dark;

  --bg: #000000;
  --surface: #1c1c1e;
  --surface-2: #2c2c2e;
  --surface-3: #3a3a3c;
  --elevated: #2c2c2e;

  --label: #f5f5f7;                         /* apple.com 深色文字 */
  --label-2: rgba(235, 235, 245, 0.60);     /* 5.94:1 on #1c1c1e、5.29:1 on #2c2c2e、4.58:1 on #3a3a3c */
  --label-3: rgba(235, 235, 245, 0.30);     /* 非文字 */
  --label-4: rgba(235, 235, 245, 0.18);
  --label-2-on-material: rgba(235, 235, 245, 0.75);

  --fill: rgba(120, 120, 128, 0.36);
  --fill-2: rgba(120, 120, 128, 0.32);
  --fill-3: rgba(118, 118, 128, 0.24);
  --fill-4: rgba(118, 118, 128, 0.18);

  --separator: rgba(84, 84, 88, 0.65);
  --separator-opaque: #38383a;

  --tint: #0a84ff;                /* 非文字；焦點環 5.76:1 on #000、3.82:1 on #2c2c2e */
  --tint-fill: #0071e3;           /* 白字 4.70:1（#0a84ff 配白字只有 3.65:1，不用） */
  --tint-fill-hover: #0077ed;
  --tint-text: #409cff;           /* 7.42 on #000、6.01 on #1c1c1e、4.92 on #2c2c2e；不可放在 #3a3a3c */
  --tint-text-on-soft: #64b5ff;   /* tinted 按鈕在 #2c2c2e 上 5.17:1 */
  --tint-soft: rgba(10, 132, 255, 0.18);
  --on-tint: #ffffff;

  --red: #ff453a;
  --red-text: #ff6961;            /* 6.03 on #1c1c1e、4.94 on #2c2c2e（#ff453a 在 #2c2c2e 只有 4.09） */
  --red-fill: #d70015;
  --red-soft: rgba(255, 69, 58, 0.18);
  --orange: #ff9f0a;
  --orange-text: #ff9f0a;         /* 8.28 on #1c1c1e、5.52 on #3a3a3c */
  --orange-soft: rgba(255, 159, 10, 0.18);
  --yellow: #ffd60a;
  --green: #30d158;
  --green-switch: #30d158;

  --material-thin: rgba(44, 44, 46, 0.60);
  --material-regular: rgba(28, 28, 30, 0.80);
  --material-thick: rgba(28, 28, 30, 0.92);
  --scrim: rgba(0, 0, 0, 0.55);

  --shadow-lift: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-overlay: 0 0 0 0.5px rgba(255, 255, 255, 0.10), 0 12px 40px rgba(0, 0, 0, 0.5);
  --shadow-sheet: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 24px 80px rgba(0, 0, 0, 0.6);
  --shadow-thumb: 0 3px 8px rgba(0, 0, 0, 0.3), 0 3px 1px rgba(0, 0, 0, 0.1);
  --segment-thumb: #636366;       /* iOS 深色分段 thumb，白字 5.99:1 */
}

/* ---------- 控制台：深色 + 密度 ---------- */
[data-theme="console"] {
  --label: #ffffff;               /* iOS 系統 label */
  --page-gutter: 6px;             /* pane 之間的間隙，露出 #000 */
  --group-gap: 12px;
  --row-min-h: 32px;              /* 控制台列（點擊區仍 ≥ 28px） */
  --row-pad-x: 12px;
}

/* Tailwind v4：必須用 inline，utilities 才會直接引用 var()，
   巢狀的 [data-theme] 才能覆寫（非 inline 會在 :root 就把值算死）。 */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-elevated: var(--elevated);
  --color-label: var(--label);
  --color-label-2: var(--label-2);
  --color-label-3: var(--label-3);
  --color-fill: var(--fill);
  --color-fill-2: var(--fill-2);
  --color-fill-3: var(--fill-3);
  --color-fill-4: var(--fill-4);
  --color-separator: var(--separator);
  --color-tint: var(--tint);
  --color-tint-fill: var(--tint-fill);
  --color-tint-text: var(--tint-text);
  --color-tint-soft: var(--tint-soft);
  --color-red: var(--red);
  --color-red-text: var(--red-text);
  --color-red-fill: var(--red-fill);
  --color-orange: var(--orange);
  --color-orange-text: var(--orange-text);
  --color-green: var(--green);

  /* 過渡期別名（第 1 階段）：舊的 utility 名稱先指到新權杖，全部頁面一次換色；第 5 階段刪除 */
  --color-panel: var(--surface);
  --color-panel-2: var(--surface-2);
  --color-panel-3: var(--surface-3);
  --color-line: var(--separator);
  --color-fg: var(--label);
  --color-muted: var(--label-2);
  --color-faint: var(--label-2);   /* 原本當文字用的 faint 一律升為 label-2 */
  --color-accent: var(--tint);
  --color-accent-2: var(--tint);
  --color-ok: var(--green);
  --color-warn: var(--orange);
  --color-danger: var(--red);

  --font-sans: var(--font-ui);
  --font-mono: var(--font-code);
}

html, body { background: var(--bg); color: var(--label); font-family: var(--font-ui); }
::selection { background: color-mix(in srgb, var(--tint) 30%, transparent); }
* { scrollbar-width: thin; scrollbar-color: var(--fill) transparent; }
```

**材質的使用規則**

| 材質 | 背景 | 濾鏡 | 用途 |
|---|---|---|---|
| thin | `--material-thin` | `--blur-thin` | 控制台歌詞列表的 sticky 段落標題、「安全控制」sticky 列、預覽上的小標籤 |
| regular | `--material-regular` | `--blur-regular` | 首頁、處理頁、編輯器的 sticky 頂欄（內容捲到下方時才出現） |
| thick | `--material-thick` | `--blur-thick` | menu、popover、toast、控制台 HUD |

- 材質上的文字只用 `--label` 與 `--label-2-on-material`（apple-design §12 Vibrancy：不要在半透明上用平灰字），字重至少 500。
- 不在材質上再疊材質（apple-design §12）。
- 控制台頂欄、面板、對話框 scrim **不用** backdrop-filter：頂欄下面沒有內容捲過；scrim 下面是持續渲染的 WebGL，
  每幀重新模糊整個畫面很貴。HUD 只有約 280×56px、只存在 1 秒，可以用。
- `@supports not (backdrop-filter: blur(1px))` 與 `prefers-reduced-transparency: reduce` 時，材質改成實色 `--surface`（或 `--elevated`）。

**對比驗證表（WCAG 2.x，文字需 ≥4.5:1，非文字 ≥3:1）**

| 前景 | 背景 | 比值 | 用途 |
|---|---|---|---|
| #1d1d1f | #f5f5f7 | 15.46 | 淺色主文字 |
| #6e6e73 | #ffffff / #f5f5f7 / #f2f2f7 | 5.07 / 4.66 / 4.54 | 淺色次要文字 |
| #ffffff | #0071e3 | 4.70 | 填色按鈕（兩種外觀） |
| #0066cc | #ffffff / #f5f5f7 | 5.57 / 5.11 | 淺色連結 |
| #d70015 | #ffffff / #f5f5f7 | 5.38 / 4.94 | 淺色紅字；#ffffff on #d70015 同為 5.38 |
| #c93400 | #ffffff | 5.28 | 淺色警告字 |
| rgba(235,235,245,.6) | #1c1c1e / #2c2c2e / #3a3a3c | 5.94 / 5.29 / 4.58 | 深色次要文字 |
| #409cff | #000 / #1c1c1e / #2c2c2e | 7.42 / 6.01 / 4.92 | 深色連結 |
| #64b5ff | tint-soft 疊 #2c2c2e | 5.17 | 控制台 tinted 按鈕文字 |
| #ff6961 | #1c1c1e / #2c2c2e | 6.03 / 4.94 | 深色紅字 |
| #ffffff | #636366 | 5.99 | 深色分段選取 |
| #0a84ff | #000 / #2c2c2e | 5.76 / 3.82 | 深色焦點環（非文字） |
| #0071e3 | #f5f5f7 | 4.31 | 淺色焦點環（非文字） |
| 不採用：#ffffff on #0a84ff 3.65、#ffffff on #ff453a 3.41、rgba(60,60,67,.6) on #fff 3.44、#ff453a on #2c2c2e 4.09、#248a3d on #f5f5f7 4.04（綠色不當小字） | | | |

### 3.2 字體排印

**字體堆疊**

```css
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang TC",
             var(--font-noto-sans-tc), "Microsoft JhengHei", system-ui, sans-serif;
  --font-numeric: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI",
                  var(--font-geist-mono), ui-monospace, sans-serif;   /* 時間碼、BPM、百分比 */
  --font-code: ui-monospace, "SF Mono", var(--font-geist-mono), Menlo, monospace;  /* 只給色碼、LRC 文字框 */
}
```

為什麼這個順序：

- `-apple-system` / `BlinkMacSystemFont` 在 macOS 與 iOS 上就是 San Francisco，Safari 會依字級自動切換 Text 與 Display 的光學尺寸。
  Chrome 在 Mac 上用 `BlinkMacSystemFont` 取得同一套字。
- 中文字元 SF 沒有，瀏覽器依序往下找，明確寫 `"PingFang TC"` 可確保拿到繁體字形（而不是 SC）。
- `"SF Pro Text"`、`"SF Pro Display"` 只在使用者自己安裝了 SF 字型時生效（常見於設計師的 Windows 電腦），沒有也無害。
- 內建的 Noto Sans TC（next/font，`preload: false`）排在 Apple 字型之後：在 Mac 上中文已被 PingFang TC 滿足，
  瀏覽器根本不會下載 Noto 的切片；在 Windows 與 Linux 上它才是真正的中文字，確保各平台一致。
  `"Microsoft JhengHei"` 只是 Noto 還沒載入前的過渡。
- `--font-numeric` 讓時間碼在 Mac 用 SF 的 tabular 數字（Clock/Timer app 的樣子），Windows 用 Segoe UI 的 tabular 數字，
  Linux 退回 Geist Mono。所有時間一律加 `font-variant-numeric: tabular-nums`（保留既有 `.tabular`）。
- 舞台字型（`FONTS` 登錄、`fontStack()`、所有 next/font 變數）完全不動，投影歌詞不受影響。

**頁面字級（首頁、處理頁、歌詞編輯器；模仿 iOS Dynamic Type 預設大小）**

| 權杖 | 字級 / 行高 | 字重 | 字距（拉丁與數字） | 用途 |
|---|---|---|---|---|
| hero | 56 / 64 | 600 | -0.005em | 首頁 hero 標題（apple.com 56px hero） |
| large-title | 34 / 44 | 700 | +0.011em | 處理頁主視覺名稱 |
| title-1 | 28 / 36 | 700 | +0.013em | 區塊標題（作品庫） |
| title-2 | 22 / 30 | 700 | +0.016em | 卡片與 sheet 大標 |
| title-3 | 20 / 28 | 600 | +0.019em | 次標、統計數值 |
| intro | 21 / 30 | 400 | +0.011em | 首頁副標（apple.com intro） |
| headline | 17 / 24 | 600 | -0.024em | 列表標題、作品名稱 |
| body | 17 / 26 | 400 | -0.024em | 內文 |
| callout | 16 / 24 | 400 | -0.020em | 說明段落 |
| subheadline | 15 / 22 | 400 | -0.016em | 次要內文、表單欄位 |
| footnote | 13 / 20 | 400 | -0.006em | 註解、群組標題 |
| caption | 12 / 18 | 400 | 0 | 標籤、時間戳、提示 |
| caption-2 | 11 / 16 | 500 | +0.006em | 最小字級（只給 tag 與刻度標籤） |

**控制台字級（桌面密度，參考 macOS）**

| 權杖 | 字級 / 行高 | 字重 | 用途 |
|---|---|---|---|
| c-caption | 11 / 14 | 500 | 最小：tag、時間軸刻度 |
| c-footnote | 12 / 16 | 400 | 時間戳、提示、次要資訊、群組標題（600） |
| c-body | 13 / 18 | 400 | 預設：歌詞列、控制項標籤（500） |
| c-headline | 15 / 20 | 600 | pane 標題、頂欄歌名 |
| c-title | 17 / 22 | 600 | 下一句、倒數提示標題 |
| c-clock | 22 / 26 | 600 | 頂欄時鐘（`--font-numeric`，tabular） |
| c-now | 28 / 36 | 700 | 「現在」大字（約 16 個中文字一行） |

**字距規則（apple-design §15 的「隨字級變化」配合中文）**

- 表中的字距值是 SF 的尺寸表（拉丁與數字）：套用在純拉丁或數字的元素（時間碼、BPM、TRACK/LIVE、色碼、英文按鍵名）。
- **中文與中英混排一律 0**，只有 28px 以上的標題可以用表中的值（值很小，混排不會擠）。中文**永遠不用正字距、永遠不 uppercase**。
  立即刪除 `tracking-[0.12em]`、`[0.14em]`、`[0.18em]`、`tracking-wide`、`tracking-wider` 與中文標籤上的 `uppercase`。
- 行高：中文內文 1.5 以上（body 17/26）；大標 1.15 到 1.3；單行控制項的行高等於控制項高度。
- 字重：400 內文、500 控制項標籤、600 標題與選取中的分段、700 只給大標。
- 最小字級 11px。刪除所有 9、10、10.5、11.5px。
- 可以用 `text-wrap: balance`（標題）與 `text-wrap: pretty`（段落）避免孤字。

實作：在 `@theme inline` 定義 `--text-*` 權杖（例如 `--text-body: 17px; --text-body--line-height: 26px; --text-body--letter-spacing: 0;`），
產生 `text-body` 等 utility；拉丁字距用 `.t-latin` 修飾（`letter-spacing: var(--tracking)`）。

### 3.3 元件規格

所有共用元件放在 `src/components/ui/`。ARCHITECTURE 列出的既有匯出（`Button`、`Panel`、`Badge`、`Kbd`、`cx`、`Markdown`）
簽名只能擴充，不能破壞。

**Button**

| 變體 | 底 | 文字 | hover（`@media (hover:hover)`） | 用途 |
|---|---|---|---|---|
| filled | `--tint-fill` | `--on-tint` 600 | `--tint-fill-hover` | 每個畫面最多一顆：開始製作、進入控制台、儲存（有變更時） |
| tinted | `--tint-soft` | `--tint-text-on-soft` | 底色 +6% | 次要但正向：重新設計、匯入 |
| gray | `--fill-3` | `--label` | `--fill-2` | 一般動作：取消、匯出、編輯歌詞 |
| plain | 無 | `--tint-text` | `--fill-4` | 文字連結式：返回、重新搜尋、重設 |
| destructive | 無（plain）或 `--red-fill`（只在 Alert 內） | `--red-text` / 白 | `--red-soft` | 刪除 |

| 尺寸 | 高 | 左右內距 | 字 | 圓角 |
|---|---|---|---|---|
| sm | 28 | 10 | 12 / 500 | 8 |
| md（預設） | 32 | 12 | 13 / 500 | 8 |
| lg | 44 | 22 | 17 / 400 | 980（膠囊，apple.com CTA；只給首頁與 sheet 主要動作） |
| icon | 28 或 32 正方 | 0 | 圖示 16 / 20 | 8 |
| circle | 36（控制台、編輯器播放鈕：白底 `--label` 反色圖示） | 0 | 圖示 20 fill | 50% |

- 按下：`:active { transform: scale(.97) }`，按下 `--dur-press` 80ms、放開 `--dur-release` 160ms，曲線 `--ease-out`；
  filled 另加 `filter: brightness(.94)`。大磚（控制台鎖定磚、場景格）用 .98。純圖示與 plain 按鈕不縮放，改 `opacity: .6`。
- transition 只列 `color, background-color, box-shadow, transform, opacity`，永遠不要 `transition-colors`（包含 outline-color）或 `all`。
- 停用：`opacity: .35`、`pointer-events: none`，標籤不變；狀態說明放在內文。
- 載入中：圖示換成 Spinner，標籤保留，`aria-busy="true"`。
- `href` 模式：傳入 `href` 時 render `next/link`，外觀與焦點環完全相同；刪除所有手刻的按鈕樣式 Link。

**SegmentedControl**（取代五種寫法與側欄底線分頁）

- 容器：高 28、內距 2、圓角 8、底 `--fill-3`（淺色）/ `--fill-3`（深色，rgba(118,118,128,.24)）。
- Thumb：一個絕對定位元素，寬 `calc((100% - 4px) / n)`，`transform: translateX(calc(var(--i) * 100%))`（直接寫在 thumb 上，
  不透過父層變數驅動子元素），圓角 6、底 `--segment-thumb`、陰影 `--shadow-thumb`。
- 各段等寬；標籤 13 / 500 `--label`，選取 600；未選取的相鄰段之間畫 `--hairline` 的 `--separator` 分隔（選取段兩側隱藏）。
- 動態：`transition: transform var(--dur-spring) var(--ease-spring)`（CSS 彈簧，控制台與其他頁同一套實作，不用 JS）。
  減少動態：`transition: none`。
- 語意：選值用 `role="radiogroup"` + `role="radio"`；切換視圖用 `role="tablist"` + `role="tab"`；roving tabindex；←→ Home End。
- 提示文字不放在段內，放在控制項下方 12px `--label-2` caption，隨選取更新。
- 用在：TRACK/LIVE、側欄四分頁、歌詞來源（自動搜尋／貼上歌詞／之後再處理）、匯入方式、播放速度、時間軸縮放。

**Switch**（iOS toggle）

- 軌道 40×24、圓角 12；關 `--fill`，開 `--green-switch`；鈕 20px 白色圓、內距 2、陰影 `0 3px 8px rgba(0,0,0,.15), 0 3px 1px rgba(0,0,0,.06)`。
- 鈕位移 16px：`transition: transform var(--dur-spring) var(--ease-spring)`；軌道顏色 200ms `ease`；按住時鈕拉寬到 24px（依所在側設定 origin）。
- `role="switch"`、`aria-checked`，Space 切換；整列（list row）都是點擊區。減少動態：沒有位移動畫，只換色。
- 用在：表格跟著播放捲動、使用 LRCLIB 的時間碼、現場音訊輸入（麥克風）、測試圖、安全區。

**Slider**

- 原生 `<input type="range">` 加樣式（保留原生無障礙）：`appearance: none`、點擊高度 28px。
- 軌道 4px、圓角 2：`background: linear-gradient(to right, var(--tint) var(--p), var(--fill) var(--p))`，`--p` 直接設在 input 上。
- 鈕 20px 白色圓，陰影 `0 0.5px 4px rgba(0,0,0,.12), 0 6px 13px rgba(0,0,0,.12)`（`::-webkit-slider-thumb` 與 `::-moz-range-thumb`）。
- 右側數值 12px tabular `--label-2`，改動過時變 `--label`（不要變強調色）；「重設」是 12px plain 按鈕。
- 拖曳時零 transition（1:1）；只有按「重設」時 `--p` 用 200ms `--ease-out` 過去。方向鍵一步、Shift 十步、Home/End。

**Stepper**（偏移 ±0.05 秒、編輯器 ±0.1 秒）

- 兩段 [−｜+]：高 28、每段寬 36、圓角 8、底 `--fill-3`、中間 `--hairline` 分隔；Phosphor Minus/Plus 14px bold。
- 按下即時 `--fill-2`；按住 400ms 後每 80ms 重複（iOS 自動重複）；Shift 為細調。
- 數值顯示在旁邊 17 / 600 tabular（控制台 15 / 600）。

**InsetGroupedList / ListRow**

- 群組：底 `--surface`（頁面，放在 `--bg` 上）或 `--surface-2`（控制台，放在 `--surface` pane 裡），圓角 12（控制台 10），
  `overflow: hidden`，無邊框、無陰影。
- 群組標題：13 / 20 `--label-2`（控制台 12 / 600），左右與列文字對齊，下方 6px；群組註腳 12px `--label-2`，上方 6px。
- 列：最小高 `--row-min-h`（44 / 控制台 32），左右 `--row-pad-x`（16 / 12），間距 12。
  - 前置：圖示 20（控制台 16），可放在 28px 圓角 7 的彩色方塊裡（設定 app 樣式，只給首頁與處理頁）。
  - 主文字 17（控制台 13）`--label`，副文字 13（控制台 12）`--label-2`。
  - 尾端：數值 `--label-2`；配件為 CaretRight 14 bold `--label-3`、Check 16 bold `--tint`、Switch、Stepper 或 Spinner。
- 分隔線從文字起點開始（不在前置圖示下方）：用 `::after`，`left` 等於文字起點，`height: var(--hairline)`，底 `--separator`；最後一列不畫。
- 可點的列：hover `--fill-4`；按下瞬間 `--fill-3`（無過渡、不縮放，列表列一分鐘會被點很多次）；焦點環內嵌（offset -2px）。
- 目前播放列（全站同一個）：左側 3px `--tint` 條、底 `--tint-soft`、文字 600。待命列：左側 3px 40% tint 條、無底。
  選取（鍵盤）：內嵌 2px `--tint` 環。

**Sheet 與 Alert**（全部用原生 `<dialog>` + `showModal()`）

- **Alert**（刪除、重新處理、自動分配、離開未儲存）：寬 340、圓角 14、內距 20 20 16、底 `--elevated`、陰影 `--shadow-sheet`；
  標題 17 / 600 置中，訊息 13 / 20 `--label-2` 置中；下方兩顆等寬 32px 按鈕（左 gray「取消」、右 destructive 實心紅「刪除」或 filled「重新處理」），
  沒有上下分隔線。初始焦點在「取消」。
- **Sheet**（匯入、重新設計、快捷鍵說明、連接 Claude 步驟）：寬 560（說明、匯入）或 640（重新設計），最高 85vh，圓角 20，底 `--elevated`，
  陰影 `--shadow-sheet`；52px 標題列：左 plain「取消」、中 15 / 600 標題、右 filled 主要動作（iOS sheet 導覽列）；內文可捲動，
  捲動後標題列下方才出現 hairline（scroll-edge）。
- Scrim：`::backdrop { background: var(--scrim) }`，不模糊。
- 動態：見 §3.4。原點置中（modal 例外）。`?` 打開的快捷鍵說明是鍵盤動作：開關都瞬間、無動畫。
- 關閉時元件保持掛載（`open || closing`），在 dialog 的 `transitionend` 後才卸載內容。
- RedesignDialog 與 HelpOverlay 遷移到這個元件，保留 B 黑場直通（`RedesignDialog.tsx:69-81` 的邏輯移到 dialog 的 keydown）與焦點歸還。

**Popover / Menu**（作品卡 ⋯、編輯器列 ⋯、外觀選單、連接 Claude 說明）

- Popover API（`popover` 屬性，top layer）加手動定位（getBoundingClientRect）；`role="menu"`、`menuitem`，↑↓ Enter Esc、輸入字首跳轉。
- 表面：`--material-thick` + `--blur-thick`，圓角 10，內距 5，最小寬 200，陰影 `--shadow-overlay`。
- 項目：高 28（控制台）/ 32，左右 10，圓角 6，13 / 400 `--label`；前置圖示 16 `--label-2`；尾端快捷鍵 Kbd。
  高亮（hover 與鍵盤）：底 `--tint-fill`、文字白（macOS 選單）。破壞性項目紅字，高亮時 `--red-fill` 白字。分隔線內縮 10。
- 動態：`transform-origin` 設在觸發元件那一側；進場 scale(.97) 到 1 加 opacity，150ms `--ease-out`；退場 100ms opacity。減少動態：只有 opacity。

**Tooltip**：見 UI-25；外觀為 `--material-thick`、圓角 8、內距 6 10、12px `--label` + Kbd；進場 125ms（scale .97 加 opacity，原點在觸發元件側），退場 100ms。

**Toolbar / AppHeader**（取代 `home/TopBar.tsx`、首頁 header、`console/TopBar.tsx` 的外框）

- 頁面版：`position: sticky; top: 0`，高 52，內容對齊頁面容器（首頁與處理頁 max-w 1200、編輯器滿版），左右 `--page-gutter`。
  - 捲動在頂端時透明（融入 `--bg`）；內容捲到下方時（用 IntersectionObserver 看頂端哨兵，設 `data-scrolled`）換成 `--material-regular`
    + `--blur-regular`，並出現 `box-shadow: inset 0 calc(-1 * var(--hairline)) 0 var(--separator)`，背景色 200ms `ease`。這就是 scroll-edge effect。
  - 左槽：首頁放品牌（28px 標誌 + 17 / 600 字標）；子頁放 plain「‹ 作品庫」（CaretLeft 17 + 15px `--tint-text`）。
  - 標題槽：歌名 15 / 600 + 樂團 13 `--label-2-on-material`，三個子頁在同一位置。
  - 右槽：gray 按鈕，最多一顆 filled。
- 控制台版：高 52，實色 `--surface`，底部 hairline，無材質。左：「‹ 作品庫」icon+文字；歌名 15 / 600 + 副標 12px `--label-2`；
  中：TRACK/LIVE 分段、傳輸控制（上一句 32 plain、播放 36 白圓、下一句 32 plain）、時鐘；狀態膠囊區；右：投影分割控制、重新設計（gray）、說明（icon）。
- z-index 階層寫在 `src/lib/ui/z.ts`：sticky 列表標題 10、頂欄 20、HUD 40、toast 50、popover/dialog 走 top layer。

**控制台側欄分頁**：用 SegmentedControl（4 等分、滿寬、pane 內距 8）；每個 tabpanel 有自己的捲動容器與記住的位置（UI-16）；
「控制」分頁的覆寫提示改成該段右上角 6px `--red` 點（語意：有覆寫生效中，保留 `aria-label`）。

**Badge / Tag / 狀態膠囊**

- Tag（中繼資料）：高 20、左右 6、圓角 6、12 / 500、底 `--fill-3`、字 `--label-2`。用在段落種類、場景名稱、「同步歌詞」。
- 狀態膠囊（只在控制台頂欄）：高 24、左右 10、圓角 980、12 / 600。嚴重：黑場用 `--red-fill` 白字（唯一的實心）；
  其他（凍結、歌詞隱藏、場景：X、等待下一句）用對應色的 soft 底加對應色字。最多同時 3 個，超過時收成「+2」。
- 狀態不用徽章表達時就用文字：「處理中…」（Spinner + `--label-2`）、「處理失敗」（紅字）。不在圖片上疊徽章；「可上台」是預設狀態，不顯示。

**Kbd**：高 20、最小寬 20、左右 5、圓角 5、底 `--fill-3`、`box-shadow: inset 0 -1px 0 var(--separator)`（鍵帽），11 / 500 系統字（不用 mono）`--label-2`；
符號用 ⌘ ⇧ ⌥ ⌃ ← → ↑ ↓ ⌫，空白鍵寫「Space」。

**ProgressBar 與活動指示**

- 確定進度：軌道 4px、圓角 2、底 `--fill-3`；填充 `--tint`，用 `transform: scaleX(p)`（原點左）240ms `linear`；上方 13px `--label-2` 說明、右側百分比 tabular。
- 不確定：Phosphor `Spinner`（8 條輻，就是 UIActivityIndicator 的樣子）16 或 20px `--label-2`，`animation: spin .8s steps(8) infinite`。
  這是全站唯一允許的循環，減少動態時也照轉（非前庭刺激，與 iOS 相同）。旁邊放 `aria-live="polite"` 的狀態文字。

**Toast / Banner**

- 控制台通知：位置頂欄下方右側（top 64、right 12），寬 360，圓角 14，`--material-thick` + `--blur-thick`，陰影 `--shadow-overlay`，
  內距 10 12；前置 16px 語意圖示（WarningCircle 紅、Warning 橘、CheckCircle 綠、Info `--label-2`）；13 / 18 `--label`；尾端 28px 關閉鈕。
  堆疊間距 8，最多 3 則；錯誤用 `role="alert"`，其他 `role="status"`。計時在 hover、focus-within、分頁隱藏時暫停。
- 編輯器頁尾 toast 用同一元件，放在下方置中。
- 頁內橫幅（處理完成、音檔錯誤、發現草稿）：不做彩色底框。`--surface` 群組、圓角 12、前置語意圖示 20、標題 15 / 600、說明 13 `--label-2`、右側按鈕。

**Empty state**：置中；圖示 44px `--label-2`；標題 17 / 600；說明 15 / 22 `--label-2`、最寬 32em；最多一個動作按鈕（plain 或 tinted）。
文案沿用既有的直接語氣。

**Skeleton**：靜態 `--fill-4` 方塊，形狀與圓角對應最終版面（卡片 14、文字列高 12 或 16、圓角 6）；延遲 300ms 才出現（本機 API 通常更快）；
可選 1.6s linear 微光（偽元素 translateX），減少動態時關閉；容器 `aria-busy="true"`。

**Icon（Phosphor）**

- 全部用 `@phosphor-icons/react`（已在 package.json，不是新依賴）。client 樹用 `IconContext.Provider`（放在一個 `"use client"` 的
  `IconProvider`，由 `app/layout.tsx` 包起來）；server component 用 `@phosphor-icons/react/dist/ssr`。
- 權重：20px 以上 `regular`；16px 以下 `bold`（線條約 1.5px，接近 SF Symbols 小尺寸的份量）；Play、Pause、錄製點與選取中的圖示用 `fill`。
- 尺寸對齊文字：11 到 12px 字配 14px；13px 字配 16px；15 到 17px 字配 20px；頂欄與工具列 20px；空狀態 44px。圖示與文字間距 6。
- 對照：Play/Pause（fill）、SkipBack/SkipForward、CaretLeft/CaretRight/CaretDown、ProjectorScreen、Sparkle、Question、Microphone、PencilSimple、
  X、CornersOut、SpeakerHigh/SpeakerSlash、WarningCircle、Warning、Info、CheckCircle、MagnifyingGlass、Check、Crosshair、ArrowSquareOut、
  UploadSimple、MusicNotes、MusicNotesPlus、Trash、ArrowClockwise、Scissors、ArrowsMerge、HandTap、HandPalm、Minus、Plus、DotsThree、
  Spinner、ArrowUUpLeft/ArrowUUpRight（復原/重做）、Export、Waveform。
- 遷移完成後刪除 `src/components/home/icons.tsx` 與 `src/components/console/icons.tsx`。

**焦點環**

```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
/* 被裁切的容器內（列表列、表格列、分段內的段）改內嵌 */
.focus-inset:focus-visible { outline-offset: -2px; }
/* listbox 用 aria-activedescendant：焦點在容器，環畫在目前的 option 上 */
[role="listbox"]:focus-visible { outline: none; }
[role="listbox"]:focus-visible [role="option"][aria-selected="true"] { box-shadow: inset 0 0 0 2px var(--tint); }
```

outline 永遠不過渡。`prefers-contrast: more` 時改 3px。Windows `forced-colors: active` 時選取與目前列要有邊框或 outline，不能只靠底色。

### 3.4 動態規格

**權杖**

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* 進場、按壓、多數 UI */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* 畫面上的移動 */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* 抽屜與 iOS sheet 感 */
  /* 臨界阻尼彈簧（damping 1.0、response 0.35s），x(t) = 1 - (1 + wt)e^(-wt)，w = 2π / 0.35，取樣 500ms */
  --ease-spring: linear(0, 0.075, 0.227, 0.39, 0.536, 0.656, 0.75, 0.821, 0.873, 0.911, 0.938,
                        0.957, 0.971, 0.98, 0.986, 0.991, 0.994, 0.996, 0.997, 0.998, 1);
  --dur-spring: 500ms;     /* 視覺上 200ms 到 87%、300ms 到 97%，尾巴不可察覺 */
  --dur-press: 80ms;
  --dur-release: 160ms;
  --dur-fast: 150ms;       /* hover、顏色 */
  --dur-base: 200ms;       /* 進場 */
  --dur-exit: 150ms;       /* 退場 */
  --dur-toast: 250ms;
}
```

```ts
// src/lib/motion.ts（motion v13）
export const spring = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;      // 預設：damping 1.0、response 約 0.35
export const springSnappy = { type: "spring", bounce: 0, visualDuration: 0.25 } as const; // 小元件
export const springMomentum = { type: "spring", bounce: 0.2, visualDuration: 0.4 } as const; // 只給有慣性的拖放放手
export const fadeReduced = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;        // 減少動態時的替代
```

**什麼用彈簧、什麼用 CSS**

| 用彈簧 | 用 CSS transition（≤200ms） | 完全不動畫 |
|---|---|---|
| 分段 thumb、開關鈕（CSS `--ease-spring`） | hover 與顏色：150ms `ease` | 快捷鍵觸發的任何狀態（B L F 1-9 0 M [ ] T O ?） |
| Sheet 進場（CSS `--ease-spring`） | 透明度：150 到 200ms `--ease-out` | 鍵盤 ↑↓ 選取造成的捲動 |
| 時間軸縮放與平移後的視窗（motion `animate()`，可重定向） | 按壓：80ms 進、160ms 出 | 時間軸拖曳、播放頭、標記拖曳（1:1） |
| 拖放進 dropzone 的圖示回饋（motion） | 進度條：240ms `linear` | 分頁內容切換、狀態膠囊出現 |
| 首頁與處理頁的 layout、stagger（motion） | 展開箭頭旋轉：200ms `--ease-out` | 快捷鍵說明 sheet 開關、HUD 出現 |

控制台頁面主執行緒很忙（WebGL 預覽加多個 rAF 迴圈）：控制台的 DOM 動態一律用 CSS transition 與 `@starting-style`；
motion 只用在 `animate()` 驅動時間軸視窗數值，以及必須做退場的 `AnimatePresence`，而且要寫完整的 `transform` 字串（WAAPI 加速），
不要用 `x`、`y`、`scale` 簡寫（review-animations STANDARDS › Performance）。

**時長表**

| 元素 | 進場 | 退場 | 曲線 | 備註 |
|---|---|---|---|---|
| 按鈕按壓 | 80ms | 160ms | `--ease-out` | 不對稱：放開較慢 |
| Tooltip | 125ms（首次延遲 400ms） | 100ms | `--ease-out` | 600ms 內再次 hover 立即顯示 |
| Menu / Popover | 150ms | 100ms | `--ease-out` | 從觸發點 scale(.97) |
| Toast / Banner | 250ms | 150ms | `--ease-out` | translateY(-8px) scale(.98)，進出同一路徑 |
| Alert | 200ms | 150ms | `--ease-out` | scale(.96) 加 opacity，置中 |
| Sheet | 500ms（`--ease-spring`，視覺約 300ms） | 150ms | 彈簧 / `--ease-out` | translateY(8px) scale(.98) |
| Scrim | 200ms | 150ms | `ease` | 只有 opacity |
| 分段 thumb、開關 | 500ms（`--ease-spring`） | 同 | 彈簧 | 可被新點擊中斷重定向 |
| 展開內容 | 200ms | 150ms | `--ease-out` | opacity 加 translateY(-4px) |
| HUD | 0ms | 停 900ms 後 250ms | `--ease-out` | 重複按鍵只更新文字並重設計時 |
| 狀態膠囊 | 0ms | 150ms | `ease` | 鍵盤觸發 |
| 連線光環 | 單次 600ms | | `--ease-out` | 只在未連線變已連線時 |
| 完成勾勾 | 200ms | | `--ease-out` | 從 scale(.9)，無回彈 |
| 摘要 stagger | 每項 40ms 間隔 | | `spring` | 最多 12 項，只在剛完成時；不阻擋操作 |

退場一律比進場快（約 60 到 75%）。任何 UI 動畫不超過 300ms 的「可見時間」（review-animations Standard 4）。
不從 `scale(0)` 開始；popover 從觸發點展開，modal 置中。

**進場寫法（原生 dialog，不用 JS 函式庫）**

```css
dialog.ui-sheet {
  opacity: 1; transform: none;
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-spring) var(--ease-spring),
              overlay var(--dur-spring) allow-discrete, display var(--dur-spring) allow-discrete;
}
@starting-style { dialog.ui-sheet[open] { opacity: 0; transform: translateY(8px) scale(0.98); } }
dialog.ui-sheet:not([open]) { opacity: 0; transform: scale(0.98); transition-duration: var(--dur-exit); transition-timing-function: var(--ease-out); }
dialog.ui-sheet::backdrop { background: var(--scrim); transition: opacity var(--dur-base) ease, overlay var(--dur-base) allow-discrete, display var(--dur-base) allow-discrete; }
@starting-style { dialog.ui-sheet[open]::backdrop { opacity: 0; } }
```

**減少動態、減少透明度、增加對比**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; }
  [data-motion="move"] { transform: none !important; translate: none !important; scale: none !important; }
  .animate-pulse, .animate-ping { animation: none; }      /* 過渡期保險；目標是這些 class 已全部移除 */
  :root { --dur-spring: 150ms; --ease-spring: ease; }     /* 滑動變成短淡入淡出或瞬間 */
}
@media (prefers-reduced-transparency: reduce) {
  .material-thin, .material-regular, .material-thick { background: var(--elevated); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  :root, [data-theme] {
    --separator: var(--separator-opaque);
    --label-2: var(--label);
    --fill-3: var(--fill);
  }
  :focus-visible { outline-width: 3px; }
  .material-thin, .material-regular, .material-thick { background: var(--elevated); backdrop-filter: none; box-shadow: 0 0 0 1px var(--separator-opaque); }
  .ui-button[data-variant="gray"], .ui-button[data-variant="plain"] { box-shadow: inset 0 0 0 1px var(--separator-opaque); }
}
```

- JS：`const reduce = useReducedMotion()`；所有 `scrollTo` 用 `behavior: reduce ? "auto" : "smooth"`；motion 動畫在 `reduce` 時改用 `fadeReduced`、不做 layout 與 stagger。
- 減少動態仍保留：顏色與透明度變化、Spinner 旋轉、HUD 淡出（它只有 opacity）。
- 外觀切換（淺色與深色）時背景顏色 200ms `ease`，避免亮度突跳（apple-design §14）。

### 3.4.1 Apple Motion 加強（使用者追加要求，優先於上面較保守的規則）

使用者明確要求「加入 Apple 的 motion 感」。上面的時長表仍是下限與安全規則；在它之上，把動態從「只是不出錯」提升到
Apple 那種**連續、有物理感、可中斷**的感覺。依據：emilkowalski `apple-design`（§1 到 §12、§14）、`animate` + `RECIPES.md`、
`find-animation-opportunities`、`animation-vocabulary`、`improve-animations`；Next.js 16 的 `<ViewTransition>`
（`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`，App Router 內建，不需設定；`<Link transitionTypes>`）。

**調整上面的規則**

- 原則 5 改為：**回饋在同一幀開始，位置變化用彈簧連續完成。**快捷鍵造成的「狀態」（黑場、歌詞開關、凍結、場景覆寫）
  仍然在同一幀生效、指示也同一幀出現；但指示的「外觀」可以有 ≤250ms 的臨界阻尼彈簧（例如 HUD 從 scale(.92)、blur(8px)
  materialize 到定位，第一幀就已可讀：opacity 起點 0.6 以上）。
- 「300ms 可見時間上限」只限一般 UI 回饋；**空間轉場**（頁面之間、共享元素、sheet、摘要揭示）可以到 400 到 550ms 的
  彈簧（視覺完成約 350ms），但必須可中斷、不阻擋輸入。
- 彈簧一律從**目前的呈現值**開始（interrupt 時讀即時 transform，不從目標值），並帶入速度（apple-design §3、§5）。

**要加入的 Apple 動態（依頁面）**

1. **跨頁空間連續性（ViewTransition）**
   - 作品庫卡片的主視覺縮圖 ↔ 處理頁／控制台頂欄的縮圖、歌名：同一個 `name`（例如 `project-art-<id>`、`project-title-<id>`）做
     shared element morph。
   - 前進（進入作品、進入控制台、進入歌詞編輯器）＝新頁從右側 24px 滑入加淡入、舊頁往左 12px 並稍微變暗；返回「‹ 作品庫」
     反向（iOS navigation push／pop 的網頁版，用 `transitionTypes={["push"]}`／`["pop"]`）。
   - 同頁內容切換（側欄分段、處理頁步驟）用 cross-fade 加依方向 ±12px 位移：分段往右切就從右邊進來（空間一致性 §7）。
   - 減少動態：全部改成 150ms cross-fade。
2. **Materialize，而不只是淡入**（apple-design §12）
   - Sheet、Popover、Menu、Tooltip、HUD、Toast：進場同時動畫 `opacity`、`scale`（.96 或 .98 起）、`filter: blur(6px→0)`；
     Menu／Popover 的 `transform-origin` 設在觸發元件（§7）。
   - 控制台上方的浮層不對 WebGL 預覽做 backdrop-filter（效能），用實色材質加陰影即可；非控制台頁面可以用真實材質。
3. **彈簧控制項**
   - SegmentedControl thumb、Switch knob、Tabs 指示器：可中斷的彈簧滑動（`spring`，按住時 thumb 稍微放大 1.04 到 1.06，
     iOS 26 的「拿起來」感覺）。
   - Slider：拖曳時 thumb 放大、軌道 1:1；超出範圍用 rubber-band（§9 的公式），放開用彈簧回到邊界。
   - 按鈕、卡片、列表列：pointerdown 立即 scale(.97)（卡片 .98），放開用 `springSnappy` 回彈到 1（不是 CSS 線性回去）。
   - 作品卡 hover：陰影加深、縮圖極輕微放大 1.02（apple.com 產品卡片），200ms `--ease-out`。
4. **手勢物理**
   - 重新設計、匯入等 Sheet：可以抓住往下拖關閉（pointer capture、保留抓取偏移、速度投射 §6 決定關閉或回彈、回彈帶速度 §5、
     往上拖 rubber-band）。
   - 控制台時間軸放大後：拖曳平移放手有慣性（`project()` 衰減、`d≈0.998`），到兩端 rubber-band；縮放（+／−／ctrl+滾輪）用
     `animate()` 彈簧重定向視窗，連按可以中斷。播放頭跟隨改成彈簧捲動視窗，不再整頁跳。
   - 播放頭、時間軸拖曳本身、標記拖曳仍然 1:1、無緩動（不可破壞）。
5. **列表與版面的連續性**
   - 控制台歌詞列表的「目前這句」高亮用一個共享的高亮層在列之間**滑動**（motion `layoutId` 或 CSS transform，
     `springSnappy`，約 200ms），自動捲動用彈簧而不是瀏覽器 smooth（減少動態時瞬移）。
   - 作品庫：刪除卡片時其餘卡片用 layout 彈簧補位；新作品出現時從上方 materialize。
   - 歌詞編輯器：新增、刪除、合併、分割列時，列的高度與位置用 layout 彈簧過渡；對拍時被標記的列有一次性的高亮掃過
     （不是循環），對拍大按鈕每按一次 Space 就有按鍵式的壓下與回彈（iOS 鍵盤按鍵的感覺）。
   - 通知堆疊：新通知從上方滑入，其餘通知用 layout 彈簧往下讓位；滑鼠停留時暫停計時；可以往右滑掉（手勢加速度）。
6. **罕見時刻（值得多花一點動態）**
   - 首頁第一次載入：標題與 dropzone 一次性 fade-up stagger（每項 60ms，`spring`），只在首次；作品庫卡片用 CSS
     scroll-driven `animation-timeline: view()` 輕微淡入上移（apple.com 產品頁的捲動揭示），減少動態時關閉。
   - 拖檔案進 dropzone：dropzone 以彈簧放大到 1.01、邊框與圖示變化；放下時圖示 morph 成音樂圖示並縮進卡片。
   - 分析完成：偵測到的 BPM、時長、段落數用數字滾動（一次，約 600ms，`--ease-out`），迷你波形從左到右揭示。
   - 處理頁：步驟完成的勾勾用 stroke 繪製（200ms），執行中的步驟用 iOS activity indicator；研究文字每段以 opacity 加
     blur(4px→0) 輕柔浮現；設計完成時主視覺摘要 materialize：色票從中心依序展開（stagger 40ms、`spring`）、motif SVG 以
     stroke 繪製、段落條由左至右生長。
   - 控制台首次載入：面板依序淡入（一次，總長 ≤400ms），之後永遠不再有入場動畫。

**不可破壞（安全規則，優先於本節）**

- 投影視窗與舞台渲染完全不動；HUD 與所有 UI 動態永遠不會出現在投影。
- 演出中（播放中或 LIVE）不出現任何無限循環動畫；Spinner 只在真的等待時出現。
- 所有動態只用 `transform`、`opacity`、`filter`（小範圍 blur），控制台不做 layout thrash；控制台的 DOM 動態優先用 CSS／WAAPI，
  `motion` 用在需要可中斷彈簧、手勢或 layout 的地方，寫完整的 `transform` 字串。
- 每一個動畫都要有 `prefers-reduced-motion` 的替代（短 cross-fade 或瞬間）。

**驗收加項**

- 路由之間有 ViewTransition（Chromium），作品卡縮圖與控制台頂欄縮圖是共享元素；返回方向相反。
- SegmentedControl、Switch、Slider、Tabs 指示器是彈簧且可中斷（快速連點兩次，thumb 不會先跑完第一段）。
- Sheet 可拖曳關閉，快速下滑（速度）即使位移不到一半也會關閉；慢拖不到一半會彈回。
- 時間軸放大後平移放手有慣性、到邊界 rubber-band；縮放可中斷。
- 歌詞列表目前列高亮是滑動的；通知堆疊用 layout 讓位。
- 減少動態下以上全部退化為 cross-fade 或瞬間。

### 3.5 各頁重設計

**首頁 `/`（apple.com 產品頁節奏）**

- AppHeader（頁面版）：左品牌；右一個安靜的狀態文字按鈕：「離線設計模式」13px `--label-2` 加 Info 圖示，或「Claude 已連線」加 6px 綠點（語意點，全站唯一的綠點）。
- Hero（最多 4 個文字元素，taste-skill §4.7）：上方留 72px；標題 hero 56 / 64 / 600「讓歌詞退居幕後，讓視覺托起樂團」（一行）；
  副標 intro 21 / 30 `--label-2`，最多兩行、最寬 34em，縮成約 20 字：「上傳一首歌，AI 以樂團專職舞台視覺設計師的角度，設計主視覺與每一段的畫面。」
- 離線說明：副標下一行 13px `--label-2`：「目前使用離線設計模式，不會上網研究樂團。」後接 plain 連結「連接 Claude」，打開 sheet 顯示 `.env.local` 步驟（code 區塊）與「重新檢查」。
- Dropzone 就是 hero 物件：`--surface` 磚，圓角 28，最小高 320，無虛線框、無光暈；中央 88px 圓形 `--tint-soft` 底內放 44px MusicNotesPlus（`--tint`）；
  標題 title-2 22 / 30 / 700「拖放一首歌到這裡」；lg 膠囊 filled 按鈕「選擇音檔」；下方 12px `--label-2` 一行：「MP3、WAV、M4A、FLAC、OGG、OPUS，最大 200 MB。音訊分析在你的瀏覽器完成，音檔只存在這台電腦。」
  拖入時：`--tint-soft` 底加 2px 虛線 `--tint` 內框、圖示 translateY(-2px) scale(1.06)（motion `spring`）。閒置、分析中、檢視三階段外框最小高相同，不跳動。
- 分析中：同一個磚內顯示歌名、ProgressBar、「分析中…」；完成後同一個磚展開成新作品卡片（opacity 加 translateY(8px) 彈簧）。
- 新作品卡片：圓角 20 `--surface`；左「歌曲資訊」inset 群組（歌名、樂團／演出者、專輯為 44px 列，左側 13px `--label-2` 標籤、右側無框輸入，
  聚焦時整列出現內嵌 2px tint 環）；下方統計列（長度、速度、段落：20 / 600 tabular 數值在上、12px `--label-2` 標籤在下，靠左三欄）與波形；
  右「歌詞」SegmentedControl（自動搜尋／貼上歌詞／之後再處理）加 caption；LRCLIB 結果為 inset 群組列（歌名 15 / 500 加「同步歌詞」tag，
  第二行 13px `--label-2`「Scorpions，Animal Magnetism，3:29」，長度差超過 3 秒時第三行橘字），右側 Check 配件；
  選中的結果下方一列 Switch「使用 LRCLIB 的時間碼」。底部：plain「取消」、lg 膠囊 filled「開始製作」。
  保留：`section[aria-label="新作品"]`、`input[required]`（form 加 `noValidate`）、標籤文字「貼上歌詞」、按鈕名稱「開始製作」。
- 作品庫：title-1「作品庫」加 `--label-2` 數量；格線 `repeat(auto-fill, minmax(260px, 1fr))`、間距 24 / 20。
  卡片：16:10 藝術圖（圓角 14，無框）：`palette[0]` 底、`palette[1]` 45% 徑向光、`palette[2]` 小弧；hover（`@media (hover:hover)`）`--shadow-lift` 加 scale(1.02) 200ms `--ease-out`。
  圖下：歌名 headline 17 / 600、樂團 15 `--label-2`、中繼 12 `--label-2`「1:13・4 分鐘前」。不是 ready 才顯示狀態文字（「處理中…」Spinner、「處理失敗」紅字加「查看」）。
  點整張卡：ready 進控制台，其他進處理頁。右下 28px ⋯ 選單按鈕（永遠可見，`--label-2`）：編輯歌詞、設計總覽、重新處理…、分隔、刪除（紅）。
  刪除後其他卡片用 motion `layout` 重排（`spring`）。
- 空狀態：作品庫標題下一個置中 Empty state：MusicNotes 44、「還沒有作品」、「把一首歌拖到上方，AI 會研究並設計它的舞台視覺。」不再做三張步驟卡。

**處理頁 `/p/[id]/process`（iOS 步驟列表、安靜的串流、主視覺展示）**

- AppHeader：‹ 作品庫、歌名加樂團；右側 gray「編輯歌詞」、filled「進入控制台」（完成後才是 filled，執行中是 gray）。容器 max-w 1200。
- 左欄 360：步驟 inset 群組，每列：狀態配件（執行中 Spinner、完成綠 Check、錯誤紅 WarningCircle、等待 `--label-3` 空心圓）、標題 15 / 500、
  說明 13 `--label-2`。完成時勾勾 200ms 進場。下方「重新設計」群組：文字框、建議詞 tag（可點，填入文字框）、tinted「重新設計」與 gray「重新研究並設計」。
- 串流面板：`--surface` 群組，13 / 20 內文；游標是 2px `--tint` 直條，`steps(2)` 1s 閃爍（減少動態時靜止）；搜尋關鍵字合成一行 `--label-2`；保留黏底與批次更新。
- 主視覺展示（完成後的主角）：16:9 即時預覽磚（圓角 20，hairline 環加深陰影）；large-title 34 主視覺名稱；概念段落 body 17 / 26 `--label-2`、最寬 60em；
  色票改成 apple.com 顏色選擇器的樣子：44px 圓形色點一排，下方名稱 12 / 600 與角色 12 `--label-2`，點擊複製 hex；視覺符號磚、字體樣張；
  四欄統計列（能量、速度、密度、音樂反應）；段落條保留；每段設計理由改成 inset 群組列（時間 tabular、段落、畫面、歌詞呈現、理由）；設計師筆記與現場提示各一個群組。
  剛完成的那一次做 40ms stagger（最多 12 項）。
- 完成橫幅：頁內 Banner（綠 CheckCircle、「設計完成」15 / 600、說明、filled「進入控制台」）；必須保留 `role="status"` 且文字含「設計完成」（e2e 依賴）。頂欄那顆此時改 plain，避免重複 CTA。
- 錯誤：Banner 用紅 WarningCircle 與紅字標題，內文保留既有具體訊息與「重試」。

**控制台 `/p/[id]`（專業 app 深色）**

- 版面：保留格線區域與比例。`<main>` 背景 `--bg` #000，pane 之間 6px 間隙，每個 pane 是 `--surface` #1c1c1e、圓角 12、**無邊框**；
  pane 內的分組用 `--surface-2` #2c2c2e 的 inset 群組（圓角 10）。
- 頂欄（52px 實色）：見 §3.3 Toolbar。播放鈕 36px 白色圓形（Play/Pause fill 20px，`--bg` 色）。時鐘 c-clock 22 / 600 `--font-numeric`，總長 `--label-2`；
  下方狀態行（「TRACK・跟隨音檔」）最多一個「・」，其餘資訊（速度、偏移、靜音）改成狀態膠囊或 HUD。
  LIVE 模式時分段內「LIVE」前加 6px 靜態紅點（on-air）。投影分割控制：左段狀態（綠點「投影已連線 1920×1080」或灰點「投影未連線」），
  右段「開啟」按鈕，整體 32px；按鈕可及名稱「開啟投影視窗」，連線文字保留「投影已連線」（e2e 依賴）。
- 狀態膠囊（頂欄中段，0ms 出現）：黑場（實心紅）、凍結（橘 soft）、歌詞隱藏（橘 soft）、場景：粒子星空（tint soft）、等待下一句（橘 soft + HandPalm）。
  「另一個控制台也在控制」「儲存失敗・重試」是紅字按鈕，放在歌名副標位置。其餘資訊（離線設計、歌詞已對時）是副標文字。
- 鍵盤 HUD（macOS 音量 HUD 的樣子）：預覽下三分之一置中，`--material-thick` + `--blur-thick`，圓角 14，內距 12 18；20px 圖示 + 15 / 600 文字 + 15 tabular `--label-2` 數值。
  0ms 出現、停 900ms、250ms 淡出；重複按鍵只更新內容並重設計時，不重新進場；只在控制台 DOM，**絕不送到投影**。
  內容：B「黑場 開／關」、L「歌詞 隱藏／顯示」、F「凍結 開／關」、1-9「場景 3・粒子星空」、0「回到設計方案」、[ ]「偏移 +0.15 秒」、
  T「拍速 121 BPM」、M「LIVE 模式／TRACK 模式」、O「已開啟投影視窗」。黑場另外保留預覽上 3px 紅環與 12px「黑場中」標籤。
- 歌詞列表：列 c-body 13 / 18（目前列 15 / 600），時間戳 12 tabular `--label-2`；段落標題是 `--material-thin` 的 sticky 列（色條、13 / 600 名稱、
  種類只在與名稱不同時出現、右側場景與歌詞樣式 12 `--label-2`）；目前、待命、選取狀態依 §3.3 ListRow 規格；強調字改「強調：夜色」12 `--label-2`；
  「回到目前」為 tinted sm 按鈕浮在列表底部。
- 預覽：框圓角 10，`box-shadow: 0 0 0 0.5px rgba(255,255,255,.08), 0 20px 50px -20px rgba(0,0,0,.6)`；角落標籤（安全區、fps）為 `--material-thin` 小膠囊 12px。
- 讀數：「現在」12 / 600 `--label-2`（無字距、無 uppercase），下面 c-now 28 / 36 / 700；空狀態「前奏（無歌詞）」`--label-2` 400；
  「下一句」c-title 17 `--label-2`。讀數 chip 改成一行純文字鍵值對（12 `--label-2` 鍵、13 `--label` 值，間距 16），不要框。
  下一個提示卡：`--surface-2` 群組，倒數 22 / 600 tabular、標題 15 / 600、說明 12 `--label-2`。
- 側欄：分段分頁（設計、研究、控制、同步）。
  - 設計：主視覺磚（保留色票漸層背景，這是內容色；eyebrow 改成 12 / 600「主視覺」無 uppercase）、色票、段落卡改成 inset 群組列（時間跳轉為 28px sm 按鈕）。
  - 控制：sticky「安全控制」列，四個 56px 大磚（圓角 10）：關 = `--fill-3` 底、`--label-2` 圖示與 `--label` 標籤、右上 Kbd；
    開 = 黑場 `--red-fill` 白字白圖示，其他 `--tint-soft` 底 `--tint-text-on-soft` 字。場景覆寫：3 欄 44px 磚（Kbd 數字 + 名稱），
    設計方案的場景標 Check 12 + 「目前段落」12 `--label-2`，覆寫中的磚加 2px tint 環與 `--tint-soft`。滑桿依 §3.3。
  - 同步：偏移 Stepper（±0.05，Shift 0.01）加 17 / 600 數值；Tap tempo 大磚；麥克風 Switch 列；音量滑桿；儀表為 3px 無底軌 tint 短條。
- 時間軸：`--surface` pane；波形未播放 `--label-3`、已播放 `--label-2`；段落塊用 colorway 35% 底加 12 / 600 名稱；播放頭 2px 白線加 8px 圓頭；
  歌詞刻度 `--label-3`；cue 菱形用語意色；縮放為 28px 分段 [−][全曲][+]；拖曳時時間氣泡（§UI-35）。
- 對話框：重新設計是 Sheet（640），快捷鍵說明是 Sheet（560，瞬間開關，內容為 inset 群組列 + Kbd）。

**歌詞編輯器 `/p/[id]/lyrics`（inset grouped 表格、對拍專注模式）**

- AppHeader：‹ 作品庫、歌名加「尚未儲存」12px `--label-2`（有變更時）；右側工具列：復原/重做是兩段分段按鈕（ArrowUUpLeft/Right），
  匯入、自動分配、匯出 .lrc 為 gray md，儲存有變更時 filled、沒有時 plain「已儲存」（⌘S）。外觀選單（系統／淺色／深色）。
- 傳輸列：白色圓形播放 36、跳轉 plain icon、時間 17 / 600 tabular、速度 SegmentedControl（0.5× 0.75× 1×）、Switch「表格跟著播放捲動」。
- 時間軸（總覽加放大）：從元素讀權杖；行區段 `--tint-soft`、目前區段 tint 30%、標記 2px `--tint`、播放頭白（深色）或 `--label`（淺色）；
  標記拖曳依 UI-20（grab offset、3px 門檻、時間氣泡、Alt 精細）。
- 表格改 inset 群組：列 44px；欄位：序號 12 `--label-2`、開始時間（15 tabular 可編輯，兩側 Stepper 式 28px −/+）、歌詞（15 `--label` 無框輸入，
  聚焦時內嵌 2px tint 環圓角 8）、翻譯（15，placeholder「翻譯（選填）」`--label-2`）。
  列尾：「從這行播放」「從這行開始對拍」兩個 28px plain icon（`--label-2`，列 hover 或 focus-within 時 `--label`），加 ⋯ 選單
  （設為目前播放位置、在下方插入、分割、與下一行合併、分隔、刪除）。所有鍵盤快捷鍵保留。
  目前列用全站同一個「目前列」權杖（tint），不再用紫色。
- 對拍專注模式（像語音備忘錄錄音）：進入時工具列下方換成全寬紅色 12% 帶，左側靜態紅點「對拍中」；中央大目標卡（`--surface` 圓角 20）：
  目前要標的那一句 title-2 22 / 700、下一句 15 `--label-2`；一顆 56px 高的大按鈕「標記（Space）」，旁邊 plain「退回（⌫）」「結束（Esc）」；
  其他列降為 `--label-2`，目標列用紅色 3px 條加 `--red-soft` 底。說明文字只有一行「播放後，在每句開唱時按 Space」，其他細節在 ? popover。
  反應時間補償滑桿收進 ⋯。進出模式時帶與卡用 200ms `--ease-out`。

### 3.6 文案替換表（em-dash、middle-dot、eyebrow）

| 位置 | 現在 | 改為 |
|---|---|---|
| `LyricsSearchPicker.tsx:35` | 「都不是」＋ em-dash ＋「之後再處理歌詞」 | 「都不是，之後再處理歌詞」 |
| `LyricsSearchPicker.tsx:155` | 「正在 LRCLIB 搜尋『歌名』」＋ em-dash ＋ 樂團 | 「正在 LRCLIB 搜尋『歌名』（樂團）…」 |
| `LyricsSearchPicker.tsx:233` | em-dash 開頭的警告 | 第三行橘字「版本長度不同，時間可能對不上，建議之後再對拍。」 |
| `UploadFlow.tsx:215` | 歌名 ＋ em-dash ＋ 樂團 | 歌名一行，樂團第二行 `--label-2` |
| `KeyVisualSummary.tsx:152` | 字體 ＋ em-dash ＋ 理由 | 理由獨立一段 13px `--label-2` |
| `HelpOverlay.tsx:58` | 雙破折號句 | 「LIVE：由你逐句送出。時間會跳到該句開頭，停在下一句開始前。」 |
| `Preview.tsx:159` | 前後加 em-dash 的「等待送出」「間奏・無歌詞」 | 「等待送出」「前奏（無歌詞）」，`--label-2` 400 |
| `Preview.tsx:165`、`TapSyncBar.tsx:91`、數值空白 | 單獨一個 em-dash | 「無」或留空 |
| `NewProjectCard.tsx:244` 頁尾 | 「接下來：取得歌詞 → 研究樂團與歌曲 → 設計主視覺與段落，約需 1」＋ en-dash ＋「3 分鐘。」 | 「接下來會取得歌詞、研究樂團與歌曲、設計主視覺與段落，約需 1 到 3 分鐘。」 |
| 時間區間 `KeyVisualSummary.tsx:230,296,349`、`DesignTab.tsx:222` | 用 en-dash 連接起訖 | 半形連字號 `0:24-0:40`（taste-skill §9.G） |
| `app/layout.tsx:6` 與各 `page.tsx` 標題 | 用 em-dash 分隔 | 「Livelyrics｜舞台歌詞視覺」「示範之歌｜控制台」「示範之歌｜設計總覽」「示範之歌｜歌詞編輯」 |
| `DesignTab.tsx:105` 色票 title | 名稱（角色）＋ em-dash ＋ 點擊複製 | 「深夜藍（背景），點擊複製 #080814」 |
| `console/TopBar.tsx:134-141` | 最多四項用「 · 」串起來 | 一個狀態詞，其餘變狀態膠囊或 HUD |
| `DesignTab.tsx:69-70` | 「主視覺 KEY VISUAL」10px uppercase 0.18em | 「主視覺」12 / 600 `--label-2` |
| `KeyVisualSummary.tsx:81` | 強調色「主視覺」eyebrow | 刪除，標題自己成立 |
| `LyricsList.tsx:299` | 「✦ 夜色」 | 「強調：夜色」 |
| `console/TopBar.tsx:92`、`States.tsx:63,84` | 專案庫、回到專案庫 | 作品庫、回到作品庫 |
| `ResearchTab.tsx:30`、`console/States.tsx:103` | 前往處理頁面 | 前往設計總覽 |

實作時用 `rg '\x{2014}|\x{2013}' src --glob '!src/components/stage/**' --glob '!src/lib/stage/**'`（U+2014 em-dash 與 U+2013 en-dash）找出所有可見字串（程式註解不算）。

---

## 4. 實作順序與驗收標準

### 實作順序

**第 0 階段：修 bug（低風險，先做）**
1. UI-01：兩個 fieldset 與 LyricsSearchPicker 加 `min-w-0`；e2e 加溢出檢查。
2. UI-16：側欄每個分頁記住捲動位置，「控制」從頂端開、安全控制 sticky。
3. UI-20：標記拖曳 grab offset 與 3px 門檻。
4. UI-28 的一半：form 加 `noValidate`，讓元件自己的錯誤顯示。

**第 1 階段：基礎（一次換掉整個外觀）**
1. `globals.css`：§3.1 權杖、`@theme inline`、過渡期別名、`color-scheme`、hairline。
2. §3.2 字體堆疊與字級 utility；刪除 9、10、10.5px 與中文正字距、uppercase。
3. §3.4 動態權杖與 `src/lib/motion.ts`；三組媒體查詢；全域焦點環（移除 outline 過渡）。
4. 控制台根元素 `data-theme="console"`；`console/Timeline.tsx` 與 `lyrics-editor/Timeline.tsx` 從元素讀權杖（刪除編輯器寫死的 `COLORS`）；
   Notices、作品卡、Waveform 的寫死 hex 改權杖。`/stage-lab` 外框 `data-theme="dark"`。
5. 移除所有 `animate-ping` 與非骨架的 `animate-pulse`（UI-13、UI-18）。

**第 2 階段：元件**
`Button`（含 href）、`SegmentedControl`、`Switch`、`Slider`、`Stepper`、`InsetGroup` / `ListRow`、`Dialog`（Alert、Sheet）、`Menu` / `Popover`、`Tooltip`、
`Tag` / 狀態膠囊、`Kbd`、`ProgressBar`、`Spinner`、`Toast` / `Banner`、`EmptyState`、`Skeleton`、`AppHeader`、`IconProvider` 與 Phosphor 遷移。
先在 `/stage-lab` 旁邊加一個 dev 用的元件頁（或 storybook 式的 `/ui-lab`，不進導覽）看兩種外觀的所有狀態。

**第 3 階段：頁面（依風險由低到高）**
首頁與上傳 → 處理頁 → 歌詞編輯器 → 控制台。控制台最後做，每一步都跑 e2e 與手動熱鍵檢查。

**第 4 階段：動態與回饋**
控制台 HUD 與狀態膠囊（UI-19）、對話框動態（UI-21）、通知（UI-34）、時間軸縮放與時間氣泡（UI-35）、上傳流程（UI-29）、
處理完成與作品庫的罕見時刻（UI-26）、展開（UI-31）、Tooltip（UI-25）。

**第 5 階段：文案與清理**
§3.6 替換表、刪除兩個 `icons.tsx`、刪除 `--color-accent-2` 與過渡期別名、把剩下的舊 utility（`bg-panel`、`text-muted`…）換成新名稱。

### 驗收標準（審查者逐項檢查）

**功能不退步**
- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通過。
- `scripts/e2e.cjs` 29 項（加上新的溢出檢查）全部通過。e2e 依賴、不可改名的掛鉤：`section[aria-label="新作品"]`、其中的 `input[required]`、
  含「貼上歌詞」的 label、名稱含「開始製作」的按鈕、含「設計完成」的 `role="status"`、`section[aria-label="時間軸"] canvas`、
  名稱含「開啟投影視窗」的按鈕、畫面文字「投影已連線」、`[role="option"][aria-current="true"]` 與 `data-line-index`、
  控制台文字含「主視覺」或「設計」與「主歌」或「副歌」、首頁文字含「Livelyrics」、編輯器歌詞 `input` 的 value。
- 投影與舞台完全沒改：`git diff --stat -- src/components/stage src/lib/stage 'src/app/p/[id]/output'` 為空
  （唯一例外是第 3.1 節說明的 `data-theme="dark"`，且需附前後截圖證明像素相同）。

**視覺**
- 每個路由與狀態都有 1440×900 與 1280×800 截圖；首頁、處理頁、編輯器在淺色與深色各一套；控制台在兩種系統外觀下都是深色且相同。
- 任何頁面、任何狀態都沒有水平捲動：`document.documentElement.scrollWidth <= clientWidth`，新作品卡片同理（LRCLIB 結果展開、點預覽後）。
- 權杖檢查（grep，排除 stage 與 output）：元件內沒有 hex 色碼（色票資料除外）；沒有 `accent-2`、`text-[9px]`、`text-[10px]`、`text-[10.5px]`；
  沒有 `tracking-[0.1`、`tracking-wide`；中文標籤沒有 `uppercase`；沒有 `transition-all`、`transition-colors`；沒有 `animate-ping`；
  沒有 `backdrop-blur` 在控制台 scrim 上；沒有 import 舊 `icons.tsx`；可見字串沒有 em-dash 與 en-dash。
- 全站只有一個 tint（systemBlue）；紅色只出現在黑場、on-air、錄製、錯誤、刪除；「目前列」在控制台、編輯器、時間軸長得一樣。
- 所有頁面的頂欄 52px、返回都是「‹ 作品庫」、標題在同一位置。

**無障礙**
- 文字對比：所有可見文字 ≥4.5:1（≥24px 或 ≥18.66px 粗體 ≥3:1）；用 Playwright 對每個文字節點算前景與實際背景的比值，兩種外觀都跑。§3.1 的對比表是下限。
- 控制台（1280 與 1440）所有可互動元素的點擊區 ≥28×28（段落文字中的內嵌連結除外），用同一支量測腳本回報 0 個。
- 鍵盤：Tab 順序合理；每個可聚焦元素都有 2px tint 焦點環，量測 Tab 後第一幀 outline-color 已是 tint（沒有過渡）；listbox 聚焦時看得到環；
  全部熱鍵照常；重新設計 sheet 開著時 B 仍然黑場；Esc 關閉所有 sheet 並把焦點還回原處。
- `emulateMedia({ reducedMotion: "reduce" })`：`document.getAnimations()` 只剩 Spinner；鍵盤與自動捲動都是 `auto`；sheet、分段、開關沒有位移。
- `prefers-reduced-transparency: reduce`（Chrome 可用 `--force-prefers-reduced-transparency` 或 emulateMedia）：沒有任何元素的 computed `backdrop-filter` 不是 none。
- `prefers-contrast: more`：分隔線變不透明、次要文字變主文字色、焦點環 3px。

**動態與回饋**
- 3.4.1「Apple Motion 加強」的**驗收加項**全部通過（ViewTransition 與共享元素、可中斷彈簧控制項、可拖曳關閉的 sheet、時間軸慣性與 rubber-band、滑動的目前列高亮、通知 layout 讓位、減少動態退化）。
- 所有按鈕 mousedown 後 100ms 的 computed transform 為 scale(.97)（大磚 .98、icon 與 plain 為 opacity .6）；列表列只有底色變化。
- 按 B、L、F、1、0、]、T、M 後下一幀：HUD 已完全不透明、頂欄膠囊已出現（0ms）；900ms 後開始淡出；HUD 不出現在投影視窗（檢查 `window.__last` 與投影 DOM）。
- LIVE 等待下一句時播放鈕沒有動畫，「下一句」有橘環，頂欄有「等待下一句」膠囊。
- 標記拖曳：在標記旁 5px 按下、移動 1px、放開，時間不變；移動 20px 時時間變化等於 20 × 秒/px（±0.01）。
- 時間軸拖曳仍然 1:1（沿用 motion 稽核的 11 點取樣），播放頭沒有 transition。
- 對話框：打開後第一幀 opacity < 1（Help 例外為 1）、300ms 內穩定；關閉後內容在退場結束前仍在 DOM。

**效能**
- 控制台 1440×900 在 Chrome 播放中：開關重新設計 sheet、連按快捷鍵、切分頁時，Performance 面板沒有來自 UI 動畫的 long task；
  除了 HUD，預覽畫布上方沒有任何 backdrop-filter。
- Mac 上首頁與控制台不下載 Noto Sans TC（Network 面板沒有 noto 字型請求）；Linux headless 上中文以 Noto Sans TC 顯示。
