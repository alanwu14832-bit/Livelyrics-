# Playback & Sync Tech for Concert/Festival LED Visuals and Lyrics (2025–2026)

## Media servers and VJ tools: what each is for, pros/cons, pricing tier

### Takeaway
The market splits into (a) affordable VJ/performance tools (Resolume Avenue/Arena, Millumin, MadMapper; ~€300–€800 perpetual), (b) node-based real-time/generative environments (TouchDesigner, Notch, Unreal), and (c) high-end touring media-server platforms (disguise, Pixera) that run on dedicated hardware and often host Notch content. For a software product, Resolume (OSC/SMPTE/Link, FFGL plugins) and TouchDesigner are the most realistic integration targets; disguise/Pixera matter as the "pro" environments whose content pipelines (Notch blocks, timecode timelines) should be interoperable.

### Cited Findings
- **Resolume pricing**: Avenue €299, Arena €799, Wire (node-based patcher) €399 per computer; 50% off for education; Black Friday 2025 sale was 35% off. Arena price reportedly unchanged since v5 (2015), Avenue since 2009 — [Resolume shop](https://www.resolume.com/software/avenue-arena); [VJ Academy Arena vs Avenue (2026)](https://vjacademy.info/learn/resolume-arena-vs-avenue); [Resolume forum BF 2025](https://www.resolume.com/forum/viewtopic.php?t=32171)
- **Resolume SMPTE is Arena-only**; Arena can listen to two SMPTE inputs simultaneously (e.g., both decks in a DJ mix); SMPTE is an audio signal Resolume decodes as a clock; used to sync audio, video, lights, pyro, lasers for show moments/intros — [Resolume support: SMPTE](https://resolume.com/support/en/smpte)
- Resolume SMPTE details: per-clip assignment to SMPTE 1 or 2 via Timeline dropdown; per-clip "offset" start timecode, with common convention of one hour per song/show (01:00:00:00, 02:00:00:00…); delay compensation in frames; frame rate "most of the time 25 or 29.97" — [Resolume support: SMPTE](https://resolume.com/support/en/smpte)
- Resolume supports Ableton Link (tempo + bar phase sync across computers); but when on Link, Resolume's "resync to start of bar" option is disabled — [Resolume support: Link](https://resolume.com/support/en/link); [Zero To VJ](https://zerotovj.com/using-ableton-link-to-sync-resolume-6-with-djs/)
- **TouchDesigner**: Non-Commercial free (resolution capped at 1280×1280, non-commercial only); Educational $300; Commercial (floating cloud) $450; Pro tier higher — [Derivative: TouchDesigner Products](https://derivative.ca/UserGuide/TouchDesigner_Products); [Derivative Licensing](https://derivative.ca/UserGuide/Licensing)
- TouchDesigner can generate SMPTE and feed Resolume Arena (community tutorial) — [Medium / Partical Weng](https://medium.com/partical.grt/use-smpte-timecode-from-touchdesigner-to-resolume-arena-466bfdbad5fe)
- **Notch (10bit FX)**: Builder commercial use is rental-only (Base ~£99/mo, Pro ~£189/mo per 2019 pricing report); non-commercial £99 perpetual with watermark; Notch Playback perpetual licences by resolution (HD £500, 4K £995, unlimited £4,250) — [CG Channel 2019](https://www.cgchannel.com/2019/10/10bit-fx-introduces-new-pricing-options-for-notch-playback/) (note: dated; check current [Notch pricing](https://getnotch.co/pricing))
- Notch exposes parameters of "Notch Blocks" that can be changed live after import into a media server; GPU rendering allows quick content turnaround — [Pixera: Hardy's Quit tour](https://pixera.one/en/showcase/creating-visual-magic-notch-blocks-and-pixera-on-hardys-quit-tour/); [ETNow](https://www.etnow.com/news/2025/4/creating-visual-magic-notch-blocks-and-pixera-on-hardys-quit-tour)
- **Pixera** on Hardy's Quit tour: handled up to two simultaneous Notch effects without dropped frames; layer-based UI managed ~50 screen mappings per show; praised for quick on-tour content updates — [Pixera showcase](https://pixera.one/en/showcase/creating-visual-magic-notch-blocks-and-pixera-on-hardys-quit-tour/). Pixera also ran Metallica's M72 World Tour — [Live Design Online](https://www.livedesignonline.com/concerts/metallica-m72-world-tour-elevates-visual-experience-pixera-media-server-system) (page 403 when fetched; headline only)
- **disguise**: GX-series hardware optimized for Notch and bundles a Notch licence; the new GX 3+ is built on NVIDIA Blackwell and includes a two-year Notch playback licence; disguise + Notch timelines of up to 40 layers per song on tour (Tiziano Ferro) — [disguise showcase](https://disguise.one/en/showcases/concert-touring/tiziano-ferro-tour); [BusinessWire Dec 2025](https://www.businesswire.com/news/home/20251222222105/en)
- disguise Designer software moved to tiers from 1 Apr 2025: free Starter (learning/evaluation, no licence) and Pro at $159/month or $1,500/year — [disguise Designer tiers](https://www.disguise.one/en/products/designer/pricing); [Designer Starter vs Pro](https://www.disguise.one/en/products/designer-starter-vs-pro)
- **Millumin** is timeline/cue-oriented (theatre, dance, museum; "runs identically every night on a stage manager's cue"), ~€399 perpetual or ~€29/week rental; **MadMapper** is a mapping "Swiss army knife" incl. lasers/LED fixtures, ~€449 perpetual or ~€44/month — [Lime Art Group 2026](https://limeartgroup.com/top-5-video-mapping-software/); [Techjockey](https://www.techjockey.com/us/blog/projection-mapping-tools) (aggregator sources; verify on vendor sites)
- Comparison of Resolume vs VDMX vs MadMapper vs TouchDesigner (Nov 2025) — [Projectile Objects](https://projectileobjects.com/2025/11/28/resolume-vs-vdmx-vs-madmapper-vs-touchdesigner-which-live-visuals-software-and-why/)
- Media-server buyer's guides — [PLSN Buyer's Guide](https://plsn.com/articles/buyers-guide/media-servers-8/)

### Inferences
- A new product should expose outputs these tools already ingest: NDI/Spout/Syphon video, OSC control, SMPTE/LTC or MTC chase, Link tempo, and ideally a Resolume FFGL/Wire or TouchDesigner component. Competing with disguise/Pixera on hardware is unrealistic; being a content/lyrics source *into* them is plausible.
- Price anchors: hobbyist/indie VJ tools €300–€800 one-off; pro design software $1.5k/yr; touring hardware far higher.

### Gaps
- Unreal Engine (free under revenue thresholds; used via disguise RenderStream) and grandMA integration (Art-Net/MA-Net/timecode, media-server fixtures via CITP) were not verified with sources in this pass.
- Pixera and disguise hardware prices not found (typically quote-based).
- Current (2026) Notch Builder pricing not confirmed; the 2019 figures may be outdated.

## Sync methods: SMPTE/LTC, MIDI clock, Link, OSC, click/playback rigs, audio-reactive, manual; handling bands off-click

### Takeaway
Pro concerts overwhelmingly run a playback rig (Ableton Live / Pro Tools / MultiTracks Playback) that plays click + backing tracks and emits SMPTE LTC (or MIDI) to lighting, video and FX; video timelines chase that timecode. Bands that don't play to click are handled with operator-triggered cues (VJ/lighting op "busking"), audio tempo-following (Ableton Tempo Follower, BPM detection -> Link), and beat-reactive rather than timeline content. Every timecode show keeps a manual fallback.

### Cited Findings
- In professional concerts backing tracks typically run in Ableton Live and output SMPTE timecode to lighting desks and video; click goes to the drummer's IEMs (not FOH); timecode is recorded on its own track and sent from a dedicated interface output via XLR — [IEM Rig: building a playback rig](https://www.iemrig.com/guides/building-a-playback-rig); [BAMFSOUND: music video playback with LTC](https://www.bamfsound.com/how-to-music-video-playback-with-ltc-timecode/)
- Timecode lets lighting, video, SFX departments program independently from the same signal; once set on the playback side it rarely changes — [Consoletrainer: Intro to Timecode on Tour](https://consoletrainer.com/timecode-intro/); [The Production Academy](https://www.theproductionacademy.com/tpa/047-using-timecode-with-live-music); [Duck Lights Timecode 101](https://www.ducklights.com/blog/timecode-101-how-to-use-timecode-for-live-shows-a-free-timecode-download)
- PLSN "Timecoding a Rock Show": drummer presses a footswitch to start the next track; a drum-tech rack backstage plays click and sends timecode; timecode drives lighting cues, audio desk levels, guitar FX, video playback. Operators "must be prepared… to operate the cues manually and keep the show running" if timecode fails. A real failure example: audio bleed from guitar tracks contaminating the LTC line — [PLSN](https://plsn.com/articles/feeding-the-machines/timecoding-a-rock-show/)
- **Ableton Tempo Follower** analyzes incoming audio (e.g., drum overhead mic) in real time so Live follows "the natural push and pull of a drummer"; optimized for signals with clear rhythm; mutually exclusive with receiving External Sync (Live can't receive MIDI clock while following), but can still *send* MIDI clock — [Ableton Live 12 manual: Sync](https://www.ableton.com/en/manual/synchronizing-with-link-tempo-follower-and-midi/)
- **MIDI Timecode (MTC)** is the MIDI form of SMPTE; Live can only be an MTC *follower* (not host) and MTC carries no meter/tempo info. **MIDI clock** is tempo-dependent ticks; Live can be clock host or follower — [Ableton manual](https://www.ableton.com/en/manual/synchronizing-with-link-tempo-follower-and-midi/)
- **Ableton Link** syncs beat, tempo and phase over wired/wireless LAN, peers keep independent transport — [Ableton manual](https://www.ableton.com/en/manual/synchronizing-with-link-tempo-follower-and-midi/); Resolume joins Link sessions — [Resolume Link](https://resolume.com/support/en/link)
- Beat detection -> visuals: FLAYSync auto-detects BPM from any audio source and pushes tempo + beat phase into Resolume via Link; Resolume forum thread on "reliable realtime BPM analyzing" — [FLAYSync](https://sync.flaysh.com/); [Resolume forum](https://resolume.com/forum/viewtopic.php?t=21604)
- Pioneer DJ Pro DJ Link can be converted to timecode/tempo for Resolume (DJ contexts) — [ProDJLink: Resolume](https://www.prodjlink.com/help/resolume)
- Laser/other systems follow the same MIDI clock / Link approach — [Modulaser BPM sync](https://modulaser.app/docs/guides/bpm-sync)
- Audio-reactive latency considerations in TouchDesigner for live sets — [audioreactivevisuals.com](https://audioreactivevisuals.com/touchdesigner-audio-reactive-latency-guide.html)

### Inferences
- A design that supports three tiers is realistic: (1) timecode-chase mode (lyrics/visual timeline locked to LTC/MTC from playback rig — sample-accurate for click bands), (2) tempo/beat mode (Link or internal beat tracker drives beat-quantized visuals when there's no click), (3) operator mode (next-line / next-section hotkeys, MIDI/OSC footswitch) as the always-available fallback.
- Timecode "hour-per-song" convention is useful as a data model: each song timeline offset at HH:00:00:00.

### Gaps
- No source found quantifying what share of festival bands play to click; industry sources assert "most" do but give no numbers.
- LTC dropout "freewheel" behaviour in Resolume (continue vs stop) not documented on the fetched page.

## How lyrics are cued in concerts

### Takeaway
Lyrics in concerts/worship are cued in three ways: (1) MIDI notes or timecode from the Ableton/Playback session triggering ProPresenter slides (fully automated, needs click), (2) pre-rendered lyric video clips chased by SMPTE in Resolume/disguise, and (3) an operator pressing "next line" (ProPresenter, Resolume add-ons like Lyricator). Karaoke-style word highlighting is uncommon live and mostly pre-rendered.

### Cited Findings
- ProPresenter 7 + Ableton: MIDI cue objects placed on Ableton's Arrangement timeline trigger slides; in the Renewed Vision/FromStudioToStage template, notes 0–27 map to cues and note 28 to "Messages"; mapping set in ProPresenter Devices > MIDI; same machine via IAC (Mac) or LoopBe1 (PC), separate machines via RTP-MIDI over Ethernet; premium iConnectivity PlayAudio12/mioXM interfaces offer auto-reconnect and backup-computer failover — [Renewed Vision blog](https://www.renewedvision.com/blog/how-to-automate-lyrics-in-propresenter-7-with-ableton)
- ProPresenter's MIDI module historically worked only on Mac (Ableton side can be Mac or PC) — [Sweetwater InSync](https://www.sweetwater.com/insync/control-propresenter-ableton-live/)
- ProPresenter 7 can be driven by timecode and you can "record" lyric slide timings against a Playback (MultiTracks.com) or Ableton timecode, reducing manual cue stress — [Technically Church, Sept 2025](https://technicallychurch.com/2025/09/how-to-record-timecode-lyrics-in-propresenter-7-with-playback-step-by-step/); [From Studio To Stage: Controlling ProPresenter with Timecode](https://fromstudiotostage.com/programs/controlling-propresenter-with-timecode?category_id=163653) (FSTS says its tools are used by touring playback engineers)
- Network MIDI automation of ProPresenter from Ableton — [Ry the Church Tech Guy](https://www.rythechurchtechguy.com/automating-propresenter-with-ableton-live-and-network-based-midi/)
- Resolume-based lyric workflow in a church production handbook uses SMPTE — [Highlands Production Handbook: Resolume SMPTE](https://docs.highlandsproduction.com/equipment/graphics-lyrics/resolume-arena/smpte)
- **Lyricator** (KPT Hippo) Resolume Avenue/Arena add-on (7.10+): paste lyrics, step forward/back line-by-line, reset, styling (size, alignment, stroke, shadow, backing box), dissolve between lines (v1.5); Arial Bold, tested in English; Thai edition exists; €11.99 — [KPT Hippo Lyricator](https://kpthippo.com/lyricator/); [Gumroad](https://kpthippo.gumroad.com/l/brwsnq); [Thai edition](https://kpthippo.com/lyricator-thai-edition/)
- Consumer synced-lyrics formats: Musixmatch (Spotify's lyrics partner) syncs line-by-line (timestamp at first sung letter, max 0.5 s early) or word-by-word; added lyrics and sync are separate steps; approved lyrics flow to Spotify in days — [Make Waves guide](https://kb.makewaves.fm/guides/how-to-add-and-sync-lyrics-in-musixmatch); [Spotify for Artists: Lyrics](https://support.spotify.com/us/artists/article/lyrics/); [Symphonic 2026](https://blog.symphonic.com/2026/04/13/get-your-lyrics-on-spotify/)

### Inferences
- Studio-recording timestamps (Musixmatch/LRC) are useful as a *prior* only; live tempo/arrangement differs, so they must be warped (by timecode if on click, or by a live tracker/operator otherwise).
- A native CJK/multilingual text engine is a differentiator: existing Resolume lyric add-ons are Arial/English-tested with language-specific editions.
- Mapping lyrics as ProPresenter-style slides with MIDI note/OSC addresses per line lets the system slot into existing playback-engineer workflows.

### Gaps
- No primary sources found on how major arena tours (e.g., K-pop, J-pop, Mandopop) cue on-screen lyrics; likely pre-rendered in the video timeline chased by timecode, but unverified.

## Automatic lyric alignment / real-time tracking

### Takeaway
Offline alignment of known lyrics to a recording is mature enough for production (stem separation + WhisperX/wav2vec2 or MFA-style forced alignment). Real-time lyric tracking of a live singer is still research-grade: best published systems (mostly classical/opera) get ~64% of words within 200 ms and ~92% within 1 s, rely on a reference recording/score, and struggle with repeats/jumps and dense band accompaniment.

### Cited Findings
- **Brazier & Widmer (ISMIR 2021)**, "On-line audio-to-lyrics alignment based on a reference performance": first real-time-capable audio-to-lyrics pipeline; predicts per-frame phoneme-class probabilities with very small temporal context, aligned against a reference recording; language-agnostic; evaluated on opera and Jingju; targets live concert/opera subtitles — [arXiv 2107.14496](https://arxiv.org/abs/2107.14496); [ISMIR archive PDF](https://archives.ismir.net/ismir2021/paper/000007.pdf)
- **Park, Yong, Kwon, Nam (KAIST, ICASSP 2024)**: chroma + phonetic posteriorgram features with On-Line Time Warping (linear time), 160 ms audio buffer; mean abs error 376 ms, median 136 ms at note level; 64.75% of word onsets within 200 ms, 92.26% within 1 s; new benchmark winterreise_rt (Schubert Winterreise); chroma mattered more than phonetics; limitations: English-trained acoustic model, only piano accompaniment — [arXiv 2401.09200](https://ar5iv.labs.arxiv.org/html/2401.09200); [KAIST MAC Lab score following](https://mac.kaist.ac.kr/score_following/score_following.html)
- Open problems cited in the field: robustness to large duration mismatches, language specificity, most methods not real-time — [Brazier & Widmer](https://arxiv.org/abs/2107.14496)
- Score followers generally fail to recover from discontinuities (repeats, D.C., coda jumps) — addressed by CODA (2026) for image-based score following — [arXiv 2607.21899](https://arxiv.org/pdf/2607.21899); related: "Just label the repeats" — [arXiv 2411.07428](https://arxiv.org/pdf/2411.07428)
- Robust real-time opera tracking combines alignment with audio event detectors — [arXiv 2006.11033](https://arxiv.org/pdf/2006.11033)
- Open-source real-time score following library Matchmaker (ISMIR 2025, piano) — [ISMIR 2025 poster](https://ismir2025program.ismir.net/poster_92.html)
- **WhisperX**: Whisper transcription + wav2vec2 phoneme forced alignment for word timestamps (+pyannote diarization) — [WhisperX paper, Interspeech 2023](https://www.isca-archive.org/interspeech_2023/bain23_interspeech.pdf); [GitHub](https://github.com/m-bain/whisperx). A GitHub issue reports WhisperX word timestamps "significantly off" vs Montreal Forced Aligner — [issue #1247](https://github.com/m-bain/whisperX/issues/1247)
- Practical recipe used by an open-source lyrics project: Demucs/UVR stem separation, then WhisperX forced alignment of the *known* lyric text for word-level timing — [canticle issue #482](https://github.com/sydlexius/canticle/issues/482)
- Whisper contains an internal word aligner (2025 research) — [arXiv 2509.09987](https://arxiv.org/pdf/2509.09987); singing-specific transcription/alignment: SongTrans, STARS — [arXiv 2409.14619](https://arxiv.org/pdf/2409.14619); [arXiv 2507.06670](https://arxiv.org/pdf/2507.06670)

### Inferences
- Viable architecture: offline pre-align lyrics to the studio track (stem separation + forced alignment), then at the show either (a) chase timecode, or (b) run an online DTW/phoneme tracker of live vocal mic vs the studio reference with section-level "jump" handling, with an operator override. Per-line (not per-word) display tolerates ~0.3–1 s error; karaoke word highlighting needs <~200 ms, which current real-time research only hits ~65% of the time.
- Using the vocal mic direct feed (from FOH split) rather than a room mic avoids band bleed, a key weakness noted in research.

### Gaps
- No published evaluation found of real-time lyric tracking on loud pop/rock band mixes or Mandarin/Japanese pop.
- Streaming (real-time) Whisper latency on sung vocals not quantified in sources found.

## Generative / AI visuals in live shows and reliability

### Takeaway
Real-time diffusion (StreamDiffusion, often inside TouchDesigner via StreamDiffusionTD) is now usable at ~20–30 fps at low resolution (512–960 px) with upscaling on high-end local GPUs; it is widely used in experimental/club/installation settings but reliability concerns (frame-rate collapse at higher res, GPU dependence, cloud latency) keep mainstream tours on pre-rendered and Notch/shader content. Local GPU and pre-rendered fallback are essential.

### Cited Findings
- StreamDiffusionTD wraps StreamDiffusion as a TouchDesigner operator, fed by audio, sensors, cameras — [Daydream blog guide](https://blog.daydream.live/real-time-generative-art-a-guide-to-streamdiffusion-and-touchdesigner/); [TouchDesigner forum 2025-03-20](https://forum.derivative.ca/t/using-streamdiffusion-with-touchdesigner-2025-03-20/650145)
- Keep resolution ~512×512 or 512×768; above ~1024×1024 framerates "tank to around 4 fps"; on an RTX Pro 6000 Blackwell, 960×540 diffusion output upscaled 2× to 1080p reaches ~27 fps with SD-Turbo — [Interactive & Immersive HQ](https://interactiveimmersive.io/blog/artificial-intelligence/using-streamdiffusion-with-touchdesigner-tips-and-tricks-for-advanced-users/); [Daydream](https://blog.daydream.live/real-time-generative-art-a-guide-to-streamdiffusion-and-touchdesigner/)
- Original StreamDiffusion paper: pipeline-level optimizations for interactive real-time generation — [arXiv 2312.12491](https://arxiv.org/html/2312.12491v2); an installation using it cycles ~20 times/second — [SIGGRAPH Asia 2025 poster](https://dl.acm.org/doi/10.1145/3757374.3771519)
- StreamDiffusionV2 (Nov 2025): first frame within 0.5 s; ~58 fps (14B model) / ~64 fps (1.3B) on four H100s — [arXiv 2511.07399](https://arxiv.org/abs/2511.07399v1)
- Remote/cloud StreamDiffusion setup (Linux GPU server interfaced with TouchDesigner) exists — [samyk/streamdiffusion](https://github.com/samyk/streamdiffusion); but remote generation adds latency, risky for live sync — [audioreactivevisuals.com](https://audioreactivevisuals.com/touchdesigner-audio-reactive-latency-guide.html)
- Commercial "AI concert visual generators" advertise 3–5 s latency reacting to structure/BPM — [freebeat.ai](https://freebeat.ai/performance/concert-visual) (vendor claim)
- AI visuals appear mostly in avant-garde festival contexts (MUTEK, Sónar+D); promoter commentary debates "showstopper vs gimmick" for 2026 — [Ticket Fairy](https://www.ticketfairy.com/blog/ai-acts-at-2026-festivals-futuristic-showstoppers-or-novelty-gimmick); [Ticket Fairy AI creativity](https://www.ticketfairy.com/blog/festival-ai-creativity-leveraging-generative-ai-for-visuals-branding-promotion)

### Inferences
- For reliability, generate AI imagery *ahead of the show* (per song, from band identity/lyrics) and play it back, using real-time AI only as an optional layer driven by audio/beat features, with automatic fallback to a pre-rendered loop if fps drops.
- Lyrics should always be rendered as a separate deterministic text layer on top of any generative layer (never inside the diffusion output).

### Gaps
- No TPi/Live Design case study found documenting real-time diffusion on a major arena tour, nor failure statistics.

## Signal chain and output: LED processors, resolution, frame rate, latency, redundancy

### Takeaway
Media server outputs (HDMI/DP/SDI or 12G/fiber) feed LED processors (NovaStar for budget/fixed/rental volume, Brompton Tessera or Megapixel Helios for premium touring/broadcast), which drive panels over Ethernet/fiber. Standard frame rates 23.976–60 fps; genlock matters when screens are filmed (IMAG/broadcast). Redundancy: backup media server (hot/cold), processor redundancy with automatic failover, and looped/redundant data paths to panels.

### Cited Findings
- Brompton SX40: ~9M pixel output, full 4K at up to 60 Hz, 12-bit, "latency-free" 4K up/down scaling; processor redundancy fails over to backup within seconds on input/output issue, optional closed-loop redundancy; Tessera 2.2+ adds processor-to-panel network redundancy configs — [Nationwide Video SX40](https://nationwidevideo.com/gear/brompton-tessera-sx40-4k-led-video-processor/); [Brompton redundancy spotlight](https://www.bromptontech.com/video/feature-spotlight-redundancy-configurations/); [ROE SX40](https://www.roevisual.com/en/products/sx-40-led-processing-platform)
- Brompton also offers ShutterSync and Frame Remapping for camera/multi-camera work; Brompton won an Engineering Emmy (2023) — [Chipshow](https://www.chipshow.com/brompton-vs-novastar-virtual-production/); [BusinessWire](https://www.businesswire.com/news/home/20230815808280/en/Brompton-Technology-Wins-Emmy%C2%AE-Award-for-Outstanding-Achievement-in-Engineering-Science-Technology)
- NovaStar suits cost-sensitive, broad-cabinet-compatibility work; Brompton when colour accuracy, HDR, broadcast/on-camera performance matter — [Dynamo LED](https://dynamo-led-displays.co.uk/novastar-vs-brompton-led-processor-comparison/); [Thor AV](https://thorav.us/video-wall-processing/)
- Capacity: NovaStar ~650k pixels per 1G port (VX1000, VX4S, MCTRL4K up to 8.3M); Brompton ~2M pixels per 10G fiber port; frame rates 23.976/24/25/29.97/30/50/60; genlock essential for broadcast; copper ~80–100 m, fiber 300 m+ (MM) to 10 km+ (SM); hot vs cold backup processors — [Show Tech guide 2025](https://www.showtechapp.com/guides/led-processor-selection)

### Inferences
- A software product outputs a normal video signal (HDMI/DP or NDI into a media server); it doesn't talk to LED processors directly, but should support arbitrary canvas sizes/aspect ratios (LED walls are rarely 16:9), 50/60 fps, and genlock-friendly frame pacing.
- Redundancy expectation: run a mirrored backup machine chasing the same timecode, with switcher failover — the software should be deterministic (same timecode -> same frame) to make this possible.

### Gaps
- Specific end-to-end latency numbers (processor frames of delay, typical 1–2 frames) not found in the fetched sources; Megapixel Helios not covered.
- Typical festival screen resolutions (pixel pitch/canvas sizes) not sourced in this pass.
