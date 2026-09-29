# Lyrics on Large Concert/Festival LED Screens: Typography, Layout, Motion, Multilingual, Rights

Research scope: readability at distance, kinetic typography examples, highlighting styles and accessibility, CJK specifics, copyright (Taiwan focus), mistakes to avoid. Practice from 2018 to 2026. About 15 tool calls. Primary-source coverage is strong for signage and subtitle numbers, moderate for Taiwan copyright, and **weak for documented lyric-display practice at specific concerts** (most tour-design write-ups do not talk about lyric typography). Where no source was found, the point goes under Gaps or Inferences.

---

## 1. Readability at distance (font size, stroke, contrast, pixel pitch, lines/characters, duration)

### Takeaway
The standard signage rules of thumb say letter height should be about 1 inch per 10 ft of viewing distance for comfortable reading, and 1 inch per 20 to 25 ft at the minimum. Keep to 2 or 3 lines at most, a few words per line, bold uniform-stroke sans-serif type, and high contrast. Subtitle standards (BBC, Netflix Traditional Chinese) give usable timing numbers: about 160 to 180 wpm for English and at most 9 Chinese characters per second, with at most 16 Traditional Chinese characters per line.

### Cited Findings
**Letter height vs distance**
- Daktronics: "Text height should be at least 1 inch for every 25 feet of viewing distance"; a 4-inch character is readable from about 100 ft. — [Daktronics KB](https://www.daktronics.com/en-us/support/kb/000030569)
- DigitalSignage.com: "1 inch (25 mm) of letter height for every 10 feet (3 m) of viewing distance reads comfortably, and 1 inch for every 20 feet is the minimum". Formula: comfortable height = distance (ft) × 0.1 in; minimum = distance × 0.05 in. — [DigitalSignage.com typography guide](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- The same guide gives a point-size formula for a 1080p canvas: body = 12 + 2.4 × viewing distance (ft), e.g. 30 ft → 84 pt body / 168 pt headline; 50 ft → 132 pt / 264 pt. — [DigitalSignage.com](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- Another signage rule: viewing distance ÷ 10 = minimum letter height in inches. — [search summary citing BIG SCREEN SOLUTIONS / Hyperlite](https://bigledscreen.com.au/led-hire/led-display-readability/)

**Pixel pitch**
- Daktronics: optimal viewing distance (ft) ≈ 3 × pixel pitch (mm), e.g. a 10 mm pitch is best at about 30 ft. Large pitch suits stadiums; "avoid overly detailed content on high-pitch displays, which may appear pixelated". — [Daktronics KB](https://www.daktronics.com/en-us/support/kb/000030569)
- Other rules in use: pitch (mm) × 10 = minimum viewing distance (ft), or "1 mm = 1 m" minimum distance. These are "not a universal standard". — [Linsn LED guide](https://www.linsnled.com/led-display-viewing-distance-guide.html); [Yuchip](https://www.yuchip-led.com/pixel-pitch-vs-viewing-distance/)

**Stroke weight, font style and contrast**
- Recommended stem widths for signage are 17 to 20% of x-height, with at least 12% for hairlines. — [legibility.info, stroke width](https://legibility.info/characters/stroke-width)
- On LED, thin strokes "disappear" at long distance, and heavy strokes make counters fill in ("halo effect" merges letters). Sans-serif fonts with uniform stroke width work best, especially at larger pixel pitch. — [Hyperlite](https://hi-hyperlite.com/blogs/comprehensive-guides/neon-sign-font-size-readability-guide); [BIG SCREEN SOLUTIONS](https://bigledscreen.com.au/led-hire/led-display-readability/)
- Font weight: Bold (700) or ExtraBold (800) for headlines, and never Light (300) or Thin (100) on signage. Contrast: 4.5:1 minimum for body text and 7:1 recommended; 3:1 minimum for large text. — [DigitalSignage.com](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- Low contrast can cut readable distance "by half or more". — [search summary, BIG SCREEN SOLUTIONS](https://bigledscreen.com.au/led-hire/led-display-readability/)
- Daktronics recommends high-contrast pairs (white on black, yellow on blue) and "bold text and minimal detail for distant viewing". — [Daktronics KB](https://www.daktronics.com/en-us/support/kb/000030569)

**How much text at once and for how long**
- The signage "3×5 rule": at most 3 lines, at most 5 words per line, 3 to 5 s viewing. Comfortable reading is 200 to 250 wpm. — [DigitalSignage.com](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- BBC subtitles: 160 to 180 wpm, about 0.3 s minimum per word (a 4-word line needs 1.2 s). Maximum line length is 68% of 16:9 frame width, about 37 to 42 characters. — [Clevercast summary of BBC guidelines](https://www.clevercast.com/bbc-subtitling-guidelines/); [Broadcast Writer 2024](https://broadcastwriter.com/2024/12/12/bbc-subtitle-style-guide-2024/)
- Netflix Traditional Chinese: 16 characters per line (18 for SDH), up to 9 characters per second for adults (11 for SDH), at most 2 lines. Prefer a bottom-heavy pyramid and do not leave a single word on the top line. Full-width punctuation only; no 、，。 at the end of a line. — [Netflix Traditional Chinese Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215994807-Traditional-Chinese-Timed-Text-Style-Guide)

### Inferences
- Worked example with the rules above: at a festival main stage with people 100 m (about 330 ft) away, the "comfortable" rule gives about 33 in (about 84 cm) letter height and the Daktronics minimum gives about 13 in (about 33 cm). On a P3.9 LED, 84 cm is about 215 pixels tall. So lyrics that must be read from the back need to take up a large part of a side screen, not look like TV subtitles.
- Hanzi have far more strokes than Latin letters (e.g. 聽, 夢, 憂鬱), so they need more pixels per character than Latin cap height. Legacy dot-matrix Chinese fonts use a 16×16 grid as the practical floor, so a safe design target on coarse-pitch walls is well above 16 physical pixels per glyph. Heavy weights (Bold/Heavy) need extra care because counters close up. This is an inference; I found no LED-specific CJK standard.
- Song lyrics cannot be retimed the way subtitles can. The subtitle cps and wpm limits mainly tell you whether a line can be read in full while it is sung. For fast verses (rap, Ado, King Gnu) full-line display will be over the limit, which argues for showing only hooks or choruses.
- "Safe area": no LED-specific percentage was found. The BBC's 68% width rule and bottom/top positioning give a reasonable starting frame. Keep lyrics off panel seams, the lower edge (blocked by crowd heads and phones), and zones that are cropped when the wall is split into IMAG windows.

### Gaps
- No published standard for pixels per CJK glyph on LED walls, and no LED-specific safe-area percentages.
- No measured data on how many lyric lines festival audiences can actually read.

---

## 2. Kinetic typography and when lyrics are shown at concerts (international and Taiwanese examples)

### Takeaway
At major tours the documented pattern is that lyrics, where they appear, are treated as part of the artwork: symbolic, stylized, and song-specific. They are not shown as full karaoke subtitles for every song. The Taiwanese studio 做事設計 (Mayday, Sodagreen) describes its job as "visualizing the lyrics" and supporting the singer, not shouting over them. Specific per-song documentation of on-screen lyric typography is scarce.

### Cited Findings
- **Taylor Swift, The Eras Tour:** the main screen is a large rectangle in three panels. Screens "lean into symbolism, showing lyrics, archival clips, and painterly backdrops that echo album artwork". Graphics by Good Company and HumanPerson, creative director Ethan Tobman. — [Wikipedia: The Eras Tour](https://en.wikipedia.org/wiki/The_Eras_Tour); [Taylor Swift Wiki](https://taylorswift.fandom.com/wiki/The_Eras_Tour) (secondary sources; which songs show lyrics was not confirmed)
- **Billie Eilish, Hit Me Hard and Soft tour (2024–25):** a 360° in-the-round stage with an LED video floor, eight multimedia towers, a luminous cube and shape-shifting overhead screens. The look is "lo-fi … glitchy and fluid" (water, infinity, abyss). Camera shots are "artfully incorporated into the content environment", meaning IMAG is mixed into the graphics rather than shown in a separate box. Moment Factory worked with GMUNK, which made content for "Over Now", "Wildflower" and "Chihiro". — [Moment Factory](https://momentfactory.com/products/billie-eilish-hit-me-hard-and-soft-the-tour); [GMUNK](https://gmunk.com/Billie-Eilish-2024-World-Tour). No lyric typography was documented.
- **YOASOBI:** for 「アイドル」 (2023), visuals on the overhead and stage-edge LEDs start as abstract noise and blocks, and hand-drawn animation is added in the climax. The LED boxes hang overhead and move up, down and tilt. Directors are 平山純一 (19-juke) and 江藤昇 (flapper3). They plan in 3D previs (After Effects, Cinema 4D, Unity). A song's visuals are planned by role: "convey imagery, display lyrics, or function like lighting". — [VIDEO SALON (1)](https://videosalon.jp/premium/vsw257_t1/); [VIDEO SALON (2)](https://videosalon.jp/premium/vsw257_t2/)
- **Mayday 五月天 / 做事設計 (Act Creative, founded 2015 by 劉乃瑋 and 卓威志):** they split concert visuals into three types: (1) turning lyrics into visual narrative (歌詞視覺化), (2) extending the stage space, and (3) building energy and atmosphere for fast songs rather than conveying meaning. Quotes: 「我們的作品不會是主角，而是烘托歌手」 ("our work is never the star; it supports the singer") and 「怎麼把歌詞轉換是最困難的」 ("how to translate the lyrics is the hardest part"), meaning how to show lyrics without being too literal. For Mayday's 「成名在望」 (2017 人生無限公司 tour), a 5-minute song with no repeated lyrics, the lyrics carry a journey through a virtual park and architecture from different countries, tied together by lines and rulers (線條、尺規). Venues usually have 3 to 4 screens, with resolution worked out per stage geometry and viewing angle. — [La Vie: 做事設計](https://www.wowlavie.com/article/ae2000184)
- Mayday's 25th-anniversary tour (5525 回到那一天) used custom circular and arc-shaped lighting structures with about 1,600 fixtures for non-linear visual design. — [La Vie via search summary](https://www.wowlavie.com/article/ae1700789); [相信音樂](https://www.bin-music.com.tw/news/1771)
- 草東沒有派對 (No Party For Cao Dong) returned to 大港開唱 in 2024 after 8 years. The festival announced them with a non-portrait image of a 「草東街」 street sign, in line with the band's low-profile visual style. — [CNA](https://www.cna.com.tw/news/amov/202311290156.aspx); [Yahoo News](https://tw.news.yahoo.com/%E7%9D%BD%E9%81%958%E5%B9%B4%E9%87%8D%E5%9B%9E%E5%8D%97%E9%9C%B8%E5%A4%A9%E8%88%9E%E5%8F%B0-%E8%8D%89%E6%9D%B1%E6%B2%92%E6%9C%89%E6%B4%BE%E5%B0%8D-%E6%98%8E%E5%B9%B4%E7%99%BB%E5%A4%A7%E6%B8%AF%E9%96%8B%E5%94%B1-041900640.html)
- General industry descriptions say LED screens show lyrics "for sing-alongs", and synchronized lyric fragments during sing-along choruses invite participation. — [reissdisplay](https://reissdisplay.com/concert-led-screen-everything-you-need-to-know/); [HeavyM](https://www.heavym.net/projection-mapping-concerts-how-visuals-transform-live-music/) (vendor or marketing sources, low authority)

### Inferences
- The shared model across sources: decide for each song whether the screen's job is imagery, lyrics or lighting (YOASOBI), and which of narrative, space or energy it serves (做事設計). Lyrics suit narrative or anthem songs and sing-along choruses. Fast, high-energy songs usually get atmosphere instead.
- A low-profile band such as 草東 would likely fit fragmentary lyric typography (single key phrases, text as texture) better than karaoke lines. This is an aesthetic inference only; no documented screen practice was found.

### Gaps
- No verifiable, citable description of which specific songs showed on-screen lyrics at Eras, Coldplay Music of the Spheres, BTS, Ado, King Gnu, 告五人, 落日飛車, or 滅火器 at 大港開唱. Searches returned fan playlists and setlists, not design documentation. Fan footage would need direct review.
- No sources on the sync method (timecode vs live VJ cueing) for lyrics specifically. The YOASOBI article did not cover sync.

---

## 3. Karaoke highlight vs full-line vs word-by-word; accessibility and captioning

### Takeaway
No design study was found comparing the three reveal styles for concerts. Accessibility practice comes mainly from theatre and live events: the UK's Stagetext uses human captioners to cue captions on screens beside the stage, and deaf-led organizations prefer humans to AI. In Taiwan, deaf fans have publicly asked for concerts with real-time captions.

### Cited Findings
- Stagetext (deaf-led UK charity, founded 2000): captions appear "on screens, usually either side of the stage, and are cued by a human being in time with the actors". The service uses only human captioners, not AI. For events it runs live subtitling with an on-site speech-to-text reporter. Stagetext+ (2025) delivers captions to caption boxes, TVs, tablets and phones at the same time. — [Stagetext theatre captioning](https://www.stagetext.org/for-venues/theatre-captioning/); [Stagetext live subtitles](https://www.stagetext.org/for-venues/live-subtitles-for-events/); [Liam O'Dell on Stagetext+, Nov 2025](https://liamodell.com/2025/11/14/stagetext-plus-theatre-captioning-awareness-week-subtitles-deaf-mercury-theatre-colchester/)
- Taiwan: a deaf fan of 張惠妹 (A-Mei) publicly wished for a friendly concert with "real-time subtitles" (即時字幕). — [The News Lens (title only; page returned 403)](https://www.thenewslens.com/article/59838)
- Netflix's Traditional Chinese SDH rules for songs: ♪ at the start and end of lyric subtitles, no italics or quotation marks for lyrics, and songs subtitled only when rights are granted. — [Netflix TC style guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215994807-Traditional-Chinese-Timed-Text-Style-Guide)

### Inferences
- **Full-line reveal**, shown slightly before it is sung, gives the reader time to read ahead (subtitle practice). This fits sing-alongs, because the crowd needs the words before singing them.
- **Karaoke fill or highlight** adds timing cues but needs frame-accurate sync. On a live band with tempo drift it looks broken unless the fill is triggered live or follows a click track and timecode.
- **Word-by-word kinetic reveal** is the most "artwork"-like. It suits slow, emphatic phrases but is poor for comprehension at speed.
- Accessibility: the artistic lyrics on the main LED and full captions for deaf and hard-of-hearing viewers should be two separate layers. Full captions can go to a dedicated side caption box or phones (the Stagetext+ model), so the art direction stays free while access is complete. Captions should also cover the MC and speech between songs, not only lyrics.

### Gaps
- No empirical comparison of the reveal styles, and no documented festival case with full live lyric captioning at a Taiwanese festival (e.g. 大港開唱, 浪人祭, 簡單生活節).
- No published caption guideline written specifically for music or lyrics at festivals (Stagetext's is theatre and speech oriented).

---

## 4. Chinese (Traditional) typography: fonts, vertical vs horizontal, bilingual layout

### Takeaway
思源黑體 (Source Han Sans / Noto Sans CJK TC) is the safe, free baseline. It is released under the SIL OFL 1.1, covers TC, SC, JP and KR plus Latin, provides Taiwan-standard glyph forms, and has 7 weights plus a variable version. Netflix's TC rules (16 characters per line, 9 cps, full-width punctuation, no line-final 、，。) carry over well to horizontal lyric lines.

### Cited Findings
- Source Han Sans (Noto Sans CJK) is by Adobe and Google, first released 16 July 2014. It covers Traditional and Simplified Chinese, Japanese, Korean, Latin, Greek and Cyrillic, with region-specific glyph standards for mainland China, Taiwan, Hong Kong, Japan and Korea. It has 7 weights (ExtraLight to Heavy) plus a variable font, and is licensed under the SIL OFL, free for commercial use. — [Wikipedia 思源黑體](https://zh.wikipedia.org/zh-tw/%E6%80%9D%E6%BA%90%E9%BB%91%E9%AB%94); [Wikipedia Source Han Sans](https://en.wikipedia.org/wiki/Source_Han_Sans)
- A list of CJK fonts for other options. — [Wikipedia List of CJK fonts](https://en.wikipedia.org/wiki/List_of_CJK_fonts)
- TC subtitle conventions (16 characters per line, 2 lines, pyramid layout, full-width punctuation, no line-final punctuation). — [Netflix TC style guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215994807-Traditional-Chinese-Timed-Text-Style-Guide)

### Inferences
- For LED use Medium to Bold weights. ExtraLight/Light will vanish, and Heavy fills in dense hanzi at coarse pitch (see section 1 stroke findings). Source Han Sans pairs with Source Han Serif (思源宋體) if the artwork calls for a 明朝體 (Ming-style serif) look for ballads. Because one family covers TC and JP, a Chinese/Japanese bilingual line stays visually consistent, and the TW vs JP glyph variants must be set per language.
- **Vertical text (直排)** suits tall formats: side-screen columns, pillars, LED towers like Billie's, or the edges of a Mayday-style arc. It carries strong literary/poster character in Taiwanese and Japanese visual culture. Horizontal Latin text does not stack well, so in a bilingual layout run CJK vertically and English/Japanese romaji horizontally in a separate block, or keep both horizontal. For English in a vertical column, rotate it 90° instead of stacking letters.
- **Bilingual hierarchy:** make the language the crowd sings in (usually Mandarin for Taiwanese bands, or Taiwanese Hokkien for 滅火器 and 拍謝少年) primary and large. Make the translation secondary, about 50 to 60% size and lighter weight, placed below or to the side. Latin text at the same point size looks visually smaller than hanzi, so optical balancing is needed. Never show three languages at once on a festival wall; it breaks the 3-line limit.
- Taiwanese Hokkien lyrics may use rare characters or 台羅 romanization. Check glyph coverage, since Source Han covers the core sets but some 台語 characters may need fallbacks.

### Gaps
- No sourced guidance on which commercial Taiwanese display families (e.g. justfont 金萱, 蘭陽明朝) are licensed for concert or broadcast use. Each foundry's license must be checked.
- No research found on vertical vs horizontal CJK legibility on LED at distance.

---

## 5. Copyright and licensing for displaying lyrics publicly (general, Taiwan / MÜST, band permission)

### Takeaway
In Taiwan the concert organizer, not the performer, obtains the public-performance license for the musical works, typically from MÜST, and failing to do so has led to criminal convictions. MÜST licenses public performance, broadcast and transmission. It does not clearly cover *reproducing* lyrics as text in screen content. TIPO treats lyrics as part of the musical work (音樂著作). The safest route is written permission from the lyricist/publisher, which in practice for an artist's own show means the band and their publisher.

### Cited Findings
- MÜST (社團法人中華音樂著作權協會, founded 1999) manages lyrics and music under three rights: public performance (公開演出), public broadcast (公開播送) and public transmission (公開傳輸). It covers about 82 million works globally. — [MÜST](https://www.must.org.tw/); [Legispedia Q&A](https://www.legis-pedia.com/QA/question/1343); [MÜST licensing page](https://www.must.org.tw/tw/license/02_1.aspx)
- The concert organizer (主辦單位) obtains the public-performance license, usually as a one-time license with a setlist. For multi-act events, organizers can estimate numbers in advance or submit setlists afterwards. Case: in 2014 promoter 東翼 held a Korean artist's concert with 7 songs and no MÜST license (Korean works are covered through reciprocal agreements with KOMCA). The company representative received 1 year imprisonment (suspended 5 years) and a NT$120,000 fine (suspended). The article does not address lyric display. — [著作權筆記](http://www.copyrightnote.org/ArticleContent.aspx?ID=6&aid=2882)
- TIPO position (via summary): lyrics are protected as musical works, not sound recordings. Displaying lyrics as on-screen text (the karaoke context) falls outside the Article 69 compulsory license for making sound recordings. — [智財散步 (page returned 503; content from search snippet)](https://iptouring.com/%E6%AD%8C%E8%A9%9E%E4%B8%8D%E6%98%AF%E9%8C%84%E9%9F%B3%E8%91%97%E4%BD%9C%EF%BC%8C%E9%9D%9E%E5%B1%AC%E8%91%97%E4%BD%9C%E6%AC%8A%E6%B3%95%E7%9A%84%E5%BC%B7%E5%88%B6%E6%8E%88%E6%AC%8A%E7%AF%84%E7%96%87/); [Taiwan Copyright Act](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=J0070017)
- Taiwan also has a second music CMO, TMCA (台灣音樂著作權集體管理協會), so repertoire may be split between societies. — [TMCA](https://www.tmca.tw/Home/Authorize)
- Streaming platforms such as Netflix subtitle songs only "when rights granted", which shows that lyric text is treated as a separately cleared right in industry practice. — [Netflix TC style guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215994807-Traditional-Chinese-Timed-Text-Style-Guide)

### Inferences
- Embedding lyrics in a pre-rendered video or LED content file is arguably 重製 (reproduction) of the musical/literary work. Showing it on screen during the show may count as 公開上映 (public screening, for audiovisual works) or fall within public performance. CMO blanket licenses for public performance may not cover the reproduction. So get explicit permission from the rights holders (lyricist or publisher, often the band's own publisher or label) in addition to the organizer's MÜST/TMCA performance license. This inference needs a lawyer or TIPO confirmation (TIPO hotline 02-2376-7182 per search result).
- If the show is recorded or streamed, lyrics burned into the screen feed also appear in broadcast/stream footage and need 公開播送/公開傳輸 clearance.
- Translated lyrics (EN/JP versions of Chinese lyrics) are derivative works (改作) and need the lyricist's consent.

### Gaps
- No TIPO 函釋 (official interpretation) located that directly addresses lyrics displayed on LED screens during a live concert. The iptouring source could not be fetched in full (503).
- No sourced international comparison (e.g. US/UK practice for "lyric display" licenses at concerts).

---

## 6. Mistakes to avoid (IMAG competition, clutter, sync)

### Takeaway
The main documented principle is that visuals should support the performer, not compete. Designers now integrate camera feeds into the graphics rather than stacking lyrics on top of IMAG. Clutter limits (3 lines, a few words) and minimum stroke and contrast rules follow from the signage guidance.

### Cited Findings
- 做事設計: 「我們的作品不會是主角，而是烘托歌手」 ("our work is never the star; it supports the singer"). Lyrics should not be too literal. — [La Vie](https://www.wowlavie.com/article/ae2000184)
- Billie Eilish tour: camera shots are "artfully incorporated into the content environment", merging IMAG with the art direction. — [Moment Factory](https://momentfactory.com/products/billie-eilish-hit-me-hard-and-soft-the-tour)
- YOASOBI: 3D previs checks how content will actually look in the venue before the show. — [VIDEO SALON](https://videosalon.jp/premium/vsw257_t1/)
- Clutter: at most 3 lines and 5 words per line; never Light/Thin weights. — [DigitalSignage.com](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- Pixel pitch: fine detail on coarse-pitch walls pixelates; content looks blurry closer than the optimal distance. — [Daktronics KB](https://www.daktronics.com/en-us/support/kb/000030569)

### Inferences (checklist)
- **Competing with IMAG:** at festivals the side screens are often the only view of the performer's face for the back half of the crowd. Placing lyrics over the face or mouth, or swapping IMAG for lyrics during key vocal moments, costs more than it gains. Options: a lower-third or side band reserved for lyrics, alternating IMAG and lyrics only on choruses, or keying lyrics into the graphic layer behind a cut-out performer.
- **Sync errors:** a lyric that appears late or shows the wrong verse (bands reorder, extend or skip sections live) is worse than no lyric. Prefer operator-cued lines (live cueing like Stagetext) or cues locked to click and timecode. Always have a "blank" safe state.
- **Clutter and stacking:** avoid three languages or long verses. Keep one idea per cue.
- **Legibility killers:** busy video behind text, low contrast, thin CJK weights, and text crossing panel seams or cut-outs in irregular LED shapes.
- **Rights and taste:** lyrics shown without the band's approval (wording, translation, typos in 台語 characters) can break the artist's identity or rights. Get the lyricist to approve final lyric text and translations.
- **Crowd sightlines:** the lower screen area is blocked by heads, flags and phones at festivals. Place lyrics in the upper-middle band.

### Gaps
- No published post-mortems or reviews that specifically criticize lyric sync failures or lyric-IMAG conflicts at named concerts.
