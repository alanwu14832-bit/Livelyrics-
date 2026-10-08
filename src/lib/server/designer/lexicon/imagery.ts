// The imagery lexicon: lyric words (繁中, English) grouped into image families, each with the
// visual associations a stage designer would reach for — a scene family (most typical first),
// colours (hues and a saturation tendency, how dark or bright), temperature, motion and an emblem.
// Curated by hand; about 450 trigger words in 56 families. Simplified lyrics are matched after
// `toTraditional`, so only traditional spellings are listed.
//
// Single characters that are part of common non-image words (今天, 大家, 開心, 花錢, 電影, 永遠,
// 腦海…) are protected by STOP_WORDS: the tokenizer consumes those compounds whole.

import type { SceneId } from "@/lib/types";
import type { EmblemStyle } from "../svg";

export type MotionKind = "still" | "drift" | "flow" | "fall" | "rise" | "pulse" | "flicker" | "burst" | "rush" | "spin";

export interface ImageryFamily {
  id: string;
  /** short 繁中 name used in titles and keywords */
  name: string;
  /** motif phrase for the key visual */
  motif: string;
  words: string[];
  /** scene family, most typical first */
  scenes: SceneId[];
  /** colour associations (degrees), most typical first */
  hues: number[];
  /** saturation tendency, ~0.3 (ash, snow) to ~1.1 (neon) */
  saturation: number;
  light: "dark" | "mid" | "bright";
  temperature: "warm" | "cool" | "neutral";
  motion: MotionKind;
  emblem: EmblemStyle;
  /** colours in words, for the brief */
  colors: string;
  /** how visual the image is, 0..1 (default 1): 「歌」「世界」 say less about colour than 「海」「火」 */
  visual?: number;
  /** 專屬畫面 forms the image calls for (src/lib/stage/program/composer.ts ids), most typical first */
  forms?: string[];
}

export const IMAGERY_FAMILIES: readonly ImageryFamily[] = [
  { id: "night", name: "夜色", motif: "入夜的城市燈火", words: ["夜色", "深夜", "午夜", "夜晚", "黑夜", "今夜", "夜裡", "夜空", "晚上", "今晚", "夜", "宵", "night", "midnight", "tonight"], scenes: ["bokeh", "particles", "nebula"], hues: [232, 250], saturation: 0.8, light: "dark", temperature: "cool", motion: "drift", emblem: "orbit", colors: "深藍、靛紫，點一點琥珀燈光" },
  { id: "stars", name: "星空", motif: "星光粒子", words: ["星空", "星星", "星光", "銀河", "流星", "星辰", "繁星", "星", "stars", "star", "galaxy", "constellation", "starlight"], scenes: ["particles", "nebula", "bokeh"], hues: [248, 280], saturation: 0.85, light: "dark", temperature: "cool", motion: "flicker", emblem: "crystal", colors: "深靛、星白、淡紫" },
  { id: "universe", name: "宇宙", motif: "漂浮的宇宙塵", words: ["宇宙", "太空", "星球", "行星", "黑洞", "軌道", "universe", "cosmos", "space", "planet", "orbit"], scenes: ["nebula", "particles", "tunnel"], hues: [265, 220], saturation: 0.8, light: "dark", temperature: "cool", motion: "spin", emblem: "orbit", colors: "宇宙紫、深藍、星塵白" },
  { id: "moon", name: "月光", motif: "月亮與光暈", words: ["月亮", "月光", "月色", "明月", "滿月", "月", "moon", "moonlight"], scenes: ["bokeh", "gradient", "nebula"], hues: [215, 45], saturation: 0.5, light: "dark", temperature: "cool", motion: "still", emblem: "orbit", colors: "月白、冷藍、淡金" },
  { id: "light", name: "燈火", motif: "一盞盞燈火", words: ["燈火", "燈光", "點亮", "光芒", "光線", "微光", "發光", "閃耀", "閃亮", "照亮", "光明", "燈", "光", "亮", "light", "lights", "shine", "shining", "glow", "bright", "lamp"], scenes: ["particles", "bokeh", "gradient"], hues: [40, 30], saturation: 0.9, light: "bright", temperature: "warm", motion: "pulse", emblem: "sun", colors: "琥珀、暖金、奶白" },
  { id: "fire", name: "火焰", motif: "燃燒的火焰", words: ["燃燒", "點燃", "火焰", "火花", "火光", "烈火", "煙火", "熱血", "燃", "火", "燒", "焚", "fire", "burn", "burning", "flame", "flames", "blaze", "spark", "sparks"], scenes: ["shards", "particles", "tunnel"], hues: [14, 32], saturation: 1, light: "mid", temperature: "warm", motion: "burst", emblem: "shard", colors: "橘紅、焰黃、焦黑" },
  { id: "sea", name: "海浪", motif: "潮汐與浪花", words: ["海浪", "海洋", "大海", "海邊", "海岸", "海風", "潮汐", "浪花", "波浪", "海", "浪", "潮", "洋", "sea", "ocean", "wave", "waves", "tide", "shore", "surf"], scenes: ["waves", "nebula", "rain"], hues: [196, 180], saturation: 0.8, light: "mid", temperature: "cool", motion: "flow", emblem: "wave", colors: "海藍、青綠、浪白" },
  { id: "rain", name: "雨", motif: "落下的雨絲", words: ["下雨", "雨天", "雨水", "大雨", "雨聲", "雨傘", "雨", "淋", "rain", "rainy", "raining", "umbrella"], scenes: ["rain", "ink", "nebula"], hues: [212, 200], saturation: 0.6, light: "dark", temperature: "cool", motion: "fall", emblem: "wave", colors: "雨灰藍、水銀、霧白" },
  { id: "tears", name: "眼淚", motif: "滑落的淚光", words: ["眼淚", "淚水", "流淚", "哭泣", "淚", "哭", "tears", "tear", "cry", "crying", "weep"], scenes: ["rain", "gradient", "bokeh"], hues: [215, 225], saturation: 0.55, light: "dark", temperature: "cool", motion: "fall", emblem: "wave", colors: "淚藍、銀灰" },
  { id: "wind", name: "風", motif: "被風吹散的字", words: ["風中", "微風", "狂風", "吹拂", "風", "吹", "飄", "wind", "breeze", "blow", "blowing"], scenes: ["waves", "particles", "nebula"], hues: [168, 190], saturation: 0.6, light: "mid", temperature: "cool", motion: "drift", emblem: "wave", colors: "薄荷、淡青、霧白" },
  { id: "sky", name: "天空", motif: "天空與雲層", words: ["天空", "雲朵", "藍天", "天際", "雲層", "白雲", "雲", "sky", "skies", "cloud", "clouds"], scenes: ["nebula", "gradient", "bokeh"], hues: [205, 195], saturation: 0.6, light: "bright", temperature: "cool", motion: "drift", emblem: "orbit", colors: "天藍、雲白" },
  { id: "snow", name: "雪", motif: "雪與冰晶", words: ["雪花", "下雪", "白雪", "冬天", "寒冬", "冰冷", "冰", "雪", "冷", "snow", "winter", "ice", "frozen", "cold"], scenes: ["particles", "gradient", "rain"], hues: [200, 210], saturation: 0.35, light: "bright", temperature: "cool", motion: "fall", emblem: "crystal", colors: "冰藍、雪白、銀灰" },
  { id: "flower", name: "花", motif: "綻放的花", words: ["花瓣", "花開", "玫瑰", "櫻花", "花朵", "綻放", "花園", "花", "flower", "flowers", "rose", "roses", "blossom", "bloom", "petal", "petals"], scenes: ["bokeh", "particles", "motif"], hues: [335, 350], saturation: 0.8, light: "mid", temperature: "warm", motion: "drift", emblem: "bloom", colors: "櫻粉、玫瑰紅、嫩綠" },
  { id: "spring", name: "春天", motif: "發芽的嫩綠", words: ["春天", "春風", "青草", "綠葉", "發芽", "草地", "春", "spring", "grass", "leaf", "green"], scenes: ["bokeh", "particles", "gradient"], hues: [110, 90], saturation: 0.7, light: "bright", temperature: "warm", motion: "rise", emblem: "bloom", colors: "嫩綠、鵝黃" },
  { id: "summer", name: "夏日", motif: "盛夏的陽光", words: ["夏天", "盛夏", "陽光", "太陽", "烈日", "日光", "夏", "summer", "sun", "sunshine", "sunny"], scenes: ["gradient", "particles", "bokeh"], hues: [45, 30], saturation: 0.95, light: "bright", temperature: "warm", motion: "pulse", emblem: "sun", colors: "金黃、橙、晴空藍" },
  { id: "autumn", name: "落葉", motif: "飄落的楓葉", words: ["秋天", "落葉", "楓葉", "枯葉", "秋", "autumn", "maple"], scenes: ["bokeh", "rain", "gradient"], hues: [28, 18], saturation: 0.75, light: "mid", temperature: "warm", motion: "fall", emblem: "bloom", colors: "楓紅、枯黃、咖啡" },
  { id: "dawn", name: "黎明", motif: "天亮的地平線", words: ["天亮", "黎明", "日出", "破曉", "曙光", "清晨", "早晨", "晨光", "dawn", "sunrise", "morning", "daybreak"], scenes: ["gradient", "particles", "bokeh"], hues: [38, 20], saturation: 0.8, light: "bright", temperature: "warm", motion: "rise", emblem: "sun", colors: "晨曦橘、淡金、粉藍" },
  { id: "dusk", name: "黃昏", motif: "沉下去的夕陽", words: ["黃昏", "夕陽", "落日", "傍晚", "晚霞", "日落", "dusk", "sunset", "twilight"], scenes: ["gradient", "bokeh", "waves"], hues: [18, 330], saturation: 0.85, light: "mid", temperature: "warm", motion: "drift", emblem: "sun", colors: "夕陽橘、晚霞粉、紫" },
  { id: "city", name: "城市", motif: "霓虹城市天際線", words: ["城市", "都市", "街道", "街頭", "街角", "大樓", "高樓", "路口", "路燈", "城", "街", "city", "street", "streets", "downtown", "building"], scenes: ["grid", "bokeh", "rain"], hues: [265, 220], saturation: 0.8, light: "dark", temperature: "cool", motion: "pulse", emblem: "crystal", colors: "霓虹紫、冷藍、路燈黃" },
  { id: "neon", name: "霓虹", motif: "閃爍的霓虹招牌", words: ["霓虹", "霓虹燈", "招牌", "燈牌", "neon", "arcade"], scenes: ["grid", "bokeh", "shards"], hues: [300, 190], saturation: 1.1, light: "dark", temperature: "cool", motion: "flicker", emblem: "crystal", colors: "霓虹粉、電光青" },
  { id: "road", name: "遠方", motif: "通往遠方的路", words: ["遠方", "遙遠", "旅程", "道路", "公路", "出發", "流浪", "前進", "方向", "路上", "一路", "路", "旅", "遠", "road", "journey", "highway", "away", "travel", "wander", "direction"], scenes: ["tunnel", "waves", "particles"], hues: [188, 30], saturation: 0.7, light: "mid", temperature: "neutral", motion: "rush", emblem: "wave", colors: "公路藍、夕照橘", visual: 0.7 },
  { id: "train", name: "列車", motif: "穿過夜的列車", words: ["列車", "火車", "捷運", "車站", "月台", "公車", "汽車", "車窗", "開車", "車", "train", "station", "platform", "car", "drive", "driving", "subway"], scenes: ["tunnel", "grid", "rain"], hues: [210, 40], saturation: 0.6, light: "mid", temperature: "cool", motion: "rush", emblem: "wave", colors: "月台藍、車燈黃" },
  { id: "window", name: "窗", motif: "窗裡的一盞光", words: ["窗戶", "窗外", "窗簾", "窗台", "窗邊", "窗前", "窗", "window", "windows", "windowpane"], scenes: ["gradient", "bokeh", "rain"], hues: [35, 210], saturation: 0.5, light: "mid", temperature: "neutral", motion: "still", emblem: "crystal", colors: "窗光暖黃、玻璃上的冷藍", visual: 0.8 },
  { id: "door", name: "門", motif: "門縫透進來的光", words: ["門口", "門邊", "門縫", "門後", "房間", "屋裡", "屋子", "屋簷", "門", "屋", "door", "doors", "doorway", "room", "hallway"], scenes: ["gradient", "ink", "bokeh"], hues: [30, 225], saturation: 0.45, light: "dark", temperature: "neutral", motion: "still", emblem: "crystal", colors: "門縫的暖光、室內的暗", visual: 0.75 },
  { id: "wall", name: "牆", motif: "水泥牆上的裂縫", words: ["高牆", "圍牆", "牆壁", "牆面", "牆角", "磚牆", "水泥", "混凝土", "牆", "wall", "walls", "concrete", "brick", "bricks"], scenes: ["shards", "grid", "ink"], hues: [210, 18], saturation: 0.3, light: "dark", temperature: "cool", motion: "still", emblem: "shard", colors: "水泥灰、裂縫裡的鏽紅", forms: ["pillars", "strata"] },
  { id: "mirror", name: "鏡子", motif: "碎裂的倒影", words: ["鏡子", "鏡中", "倒影", "倒映", "鏡", "mirror", "reflection"], scenes: ["shards", "gradient", "ink"], hues: [200, 290], saturation: 0.5, light: "mid", temperature: "cool", motion: "still", emblem: "crystal", colors: "銀、冷灰、淡紫", visual: 0.9 },
  { id: "dream", name: "夢境", motif: "漂浮的夢境", words: ["夢想", "夢境", "作夢", "做夢", "夢裡", "夢中", "幻想", "夢", "dream", "dreams", "dreaming", "fantasy"], scenes: ["nebula", "bokeh", "particles"], hues: [282, 320], saturation: 0.75, light: "mid", temperature: "cool", motion: "drift", emblem: "orbit", colors: "夢幻紫、粉、霧藍", visual: 0.8 },
  { id: "heart", name: "心跳", motif: "心跳脈動", words: ["心跳", "心臟", "心動", "心裡", "心中", "心", "heartbeat", "heart", "hearts", "pulse"], scenes: ["particles", "motif", "gradient"], hues: [350, 340], saturation: 0.9, light: "mid", temperature: "warm", motion: "pulse", emblem: "sun", colors: "心跳紅、玫瑰粉", visual: 0.8 },
  // Round 14 (sensitive lyrics, after chrimage/ai-lyric-video-generator's broadcast-safe prompts): blood,
  // death and self-harm words read as withered petals, wounds as broken glass, weapons and violence as
  // a storm, cages as chains breaking, drugs as haze, sex as candlelight — never the literal thing.
  { id: "wither", name: "凋零", motif: "凋零的花瓣", words: ["鮮血", "血液", "流血", "死亡", "死去", "死掉", "屍體", "墳墓", "墓碑", "骷髏", "葬禮", "自殺", "割腕", "自殘", "輕生", "血", "blood", "bleed", "bleeding", "dying", "dead", "death", "corpse", "corpses", "grave", "graves", "coffin", "skull", "skulls", "funeral", "suicide", "suicidal"], scenes: ["rain", "ink", "gradient"], hues: [340, 280], saturation: 0.5, light: "dark", temperature: "cool", motion: "fall", emblem: "bloom", colors: "褪色的玫瑰紅、灰紫、深黑" },
  { id: "metal", name: "鋼鐵", motif: "鏽蝕的鋼鐵", words: ["鋼鐵", "金屬", "機器", "齒輪", "鐵軌", "鐵", "鋼", "鏽", "metal", "steel", "iron", "machine", "rust"], scenes: ["grid", "shards", "ink"], hues: [210, 25], saturation: 0.3, light: "dark", temperature: "cool", motion: "spin", emblem: "crystal", colors: "鋼灰、鏽橘、冷銀" },
  { id: "chains", name: "枷鎖", motif: "斷裂的鎖鏈", words: ["鎖鏈", "鐵鏈", "枷鎖", "牢籠", "囚禁", "監獄", "束縛", "chain", "chains", "cage", "caged", "prison", "shackles"], scenes: ["shards", "grid", "ink"], hues: [215, 42], saturation: 0.4, light: "dark", temperature: "cool", motion: "burst", emblem: "shard", colors: "鐵灰、斷口的一道金光", visual: 0.9 },
  { id: "glass", name: "碎片", motif: "破碎的玻璃", words: ["破碎", "碎片", "玻璃", "碎裂", "裂縫", "崩塌", "傷口", "傷痕", "疤痕", "碎", "裂", "疤", "broken", "glass", "shatter", "shattered", "crack", "pieces", "wound", "wounds", "scar", "scars"], scenes: ["shards", "ink", "particles"], hues: [300, 190], saturation: 0.7, light: "mid", temperature: "cool", motion: "burst", emblem: "shard", colors: "碎玻璃青、紫" },
  { id: "dark", name: "黑暗", motif: "黑暗中的裂縫", words: ["黑暗", "深淵", "陰影", "影子", "暗處", "無底", "暗", "影", "dark", "darkness", "shadow", "shadows", "abyss", "void"], scenes: ["ink", "gradient", "nebula"], hues: [262, 240], saturation: 0.6, light: "dark", temperature: "cool", motion: "still", emblem: "shard", colors: "深黑、暗紫" },
  { id: "forest", name: "山林", motif: "山與森林的剪影", words: ["森林", "山谷", "山頂", "高山", "樹林", "樹", "山", "林", "forest", "mountain", "mountains", "tree", "trees", "woods", "valley"], scenes: ["ink", "nebula", "particles"], hues: [140, 110], saturation: 0.6, light: "mid", temperature: "neutral", motion: "still", emblem: "crystal", colors: "墨綠、苔綠、山嵐灰" },
  { id: "river", name: "河流", motif: "流動的河", words: ["河流", "溪流", "湖水", "湖泊", "流水", "河", "溪", "湖", "水", "river", "stream", "lake", "water"], scenes: ["waves", "ink", "nebula"], hues: [190, 175], saturation: 0.65, light: "mid", temperature: "cool", motion: "flow", emblem: "wave", colors: "湖水綠、河藍" },
  { id: "harbor", name: "港口", motif: "港口與燈塔", words: ["島嶼", "海港", "港口", "碼頭", "燈塔", "船", "島", "港", "island", "harbor", "harbour", "port", "pier", "lighthouse", "boat", "ship", "sail"], scenes: ["waves", "bokeh", "gradient"], hues: [200, 40], saturation: 0.65, light: "mid", temperature: "cool", motion: "drift", emblem: "wave", colors: "港藍、燈塔黃" },
  { id: "desert", name: "荒漠", motif: "無邊的沙丘", words: ["沙漠", "沙丘", "荒漠", "荒野", "沙", "desert", "dune", "sand", "wasteland"], scenes: ["gradient", "particles", "waves"], hues: [35, 25], saturation: 0.7, light: "bright", temperature: "warm", motion: "drift", emblem: "sun", colors: "沙金、赭" },
  { id: "storm", name: "雷電", motif: "劈開夜空的閃電", words: ["雷電", "閃電", "雷聲", "打雷", "暴風雨", "暴雨", "風暴", "颱風", "雷", "刀子", "刀鋒", "匕首", "殺死", "殺人", "謀殺", "暴力", "開槍", "子彈", "槍", "刀", "殺", "thunder", "lightning", "storm", "stormy", "kill", "killing", "killer", "murder", "knife", "knives", "blade", "gun", "guns", "bullet", "bullets", "shoot", "violence", "violent"], scenes: ["shards", "rain", "ink"], hues: [250, 55], saturation: 0.8, light: "dark", temperature: "cool", motion: "burst", emblem: "shard", colors: "電光白、暴風紫" },
  { id: "wings", name: "飛翔", motif: "張開的翅膀", words: ["翅膀", "飛翔", "飛鳥", "羽毛", "飛", "鳥", "翼", "wings", "wing", "fly", "flying", "bird", "birds", "feather"], scenes: ["particles", "nebula", "gradient"], hues: [195, 45], saturation: 0.65, light: "bright", temperature: "neutral", motion: "rise", emblem: "bloom", colors: "天青、羽白" },
  { id: "freedom", name: "自由", motif: "衝破邊界的光", words: ["自由", "解放", "逃離", "掙脫", "奔跑", "奔向", "free", "freedom", "escape", "run", "running"], scenes: ["tunnel", "particles", "gradient"], hues: [190, 50], saturation: 0.85, light: "bright", temperature: "warm", motion: "rush", emblem: "sun", colors: "晴藍、陽光黃", visual: 0.7 },
  { id: "memory", name: "時光", motif: "時光與回憶", words: ["時光", "回憶", "記憶", "從前", "過去", "時間", "昨天", "往事", "曾經", "懷念", "時鐘", "歲月", "光陰", "time", "memory", "memories", "remember", "yesterday", "past", "clock"], scenes: ["bokeh", "gradient", "ink"], hues: [30, 40], saturation: 0.55, light: "mid", temperature: "warm", motion: "drift", emblem: "orbit", colors: "懷舊棕、褪色金", visual: 0.7 },
  { id: "writing", name: "筆墨", motif: "書寫的筆墨", words: ["寫下", "名字", "文字", "詩句", "日記", "信紙", "寫", "信", "紙", "筆", "墨", "字", "詩", "write", "written", "letter", "words", "poem", "paper", "ink", "name"], scenes: ["ink", "motif", "gradient"], hues: [160, 40], saturation: 0.5, light: "mid", temperature: "neutral", motion: "still", emblem: "shard", colors: "墨黑、紙白", visual: 0.6 },
  { id: "voice", name: "歌聲", motif: "一起唱的聲浪", words: ["歌聲", "唱歌", "歌唱", "旋律", "聲音", "吶喊", "大聲", "歌", "唱", "喊", "song", "songs", "sing", "singing", "voice", "melody", "shout", "scream"], scenes: ["waves", "particles", "motif"], hues: [285, 40], saturation: 0.8, light: "mid", temperature: "neutral", motion: "pulse", emblem: "wave", colors: "聲波紫、暖金", visual: 0.4 },
  { id: "dance", name: "舞池", motif: "旋轉的舞池燈", words: ["跳舞", "舞池", "舞步", "派對", "狂歡", "搖擺", "舞", "dance", "dancing", "party", "club", "groove"], scenes: ["grid", "particles", "shards"], hues: [310, 190], saturation: 1.05, light: "dark", temperature: "warm", motion: "pulse", emblem: "sun", colors: "迪斯可粉、電光藍" },
  { id: "smoke", name: "煙霧", motif: "繚繞的煙霧", words: ["香菸", "煙霧", "迷霧", "毒品", "嗑藥", "吸毒", "藥丸", "迷幻", "大麻", "菸", "煙", "霧", "酒", "醉", "smoke", "fog", "mist", "haze", "whiskey", "wine", "drunk", "drug", "drugs", "pill", "pills", "cocaine", "heroin", "weed"], scenes: ["nebula", "gradient", "ink"], hues: [30, 260], saturation: 0.4, light: "dark", temperature: "neutral", motion: "drift", emblem: "orbit", colors: "煙灰、琥珀酒色" },
  { id: "ash", name: "灰燼", motif: "落下的灰燼", words: ["灰燼", "塵埃", "灰塵", "塵土", "灰", "塵", "ash", "ashes", "dust"], scenes: ["particles", "ink", "gradient"], hues: [30, 0], saturation: 0.25, light: "dark", temperature: "neutral", motion: "fall", emblem: "crystal", colors: "灰燼灰、焦棕" },
  { id: "signal", name: "訊號", motif: "雜訊與電波", words: ["電流", "訊號", "頻率", "電波", "雜訊", "電", "signal", "static", "frequency", "electric", "radio", "noise"], scenes: ["grid", "waves", "shards"], hues: [180, 290], saturation: 0.9, light: "dark", temperature: "cool", motion: "flicker", emblem: "crystal", colors: "電光青、雜訊白" },
  { id: "screen", name: "螢幕", motif: "發光的螢幕", words: ["螢幕", "手機", "電視", "網路", "訊息", "數位", "像素", "screen", "phone", "internet", "message", "digital", "pixel"], scenes: ["grid", "shards", "particles"], hues: [190, 300], saturation: 0.85, light: "dark", temperature: "cool", motion: "flicker", emblem: "crystal", colors: "螢幕藍光、像素綠" },
  { id: "eyes", name: "眼神", motif: "注視的眼睛", words: ["眼睛", "眼神", "目光", "雙眼", "凝視", "眼", "eyes", "eye", "gaze", "stare"], scenes: ["motif", "bokeh", "gradient"], hues: [200, 40], saturation: 0.6, light: "mid", temperature: "neutral", motion: "still", emblem: "orbit", colors: "瞳孔褐、冷光", visual: 0.7 },
  { id: "candle", name: "燭光", motif: "燭光與絲綢的影子", words: ["做愛", "上床", "赤裸", "裸體", "性感", "慾望", "情慾", "sex", "sexy", "naked", "nude", "lust", "desire"], scenes: ["bokeh", "gradient", "nebula"], hues: [345, 32], saturation: 0.6, light: "dark", temperature: "warm", motion: "drift", emblem: "bloom", colors: "酒紅、燭光金、深紫", visual: 0.8 },
  { id: "embrace", name: "擁抱", motif: "相擁的溫度", words: ["擁抱", "牽手", "雙手", "手心", "懷抱", "抱", "hug", "embrace", "hand", "hands", "hold"], scenes: ["bokeh", "gradient", "particles"], hues: [20, 340], saturation: 0.7, light: "mid", temperature: "warm", motion: "still", emblem: "bloom", colors: "膚色暖橘、柔粉", visual: 0.7 },
  { id: "breath", name: "呼吸", motif: "起伏的呼吸", words: ["呼吸", "身體", "喘息", "皮膚", "breathe", "breath", "breathing", "body", "skin"], scenes: ["gradient", "nebula", "waves"], hues: [15, 200], saturation: 0.5, light: "mid", temperature: "neutral", motion: "flow", emblem: "orbit", colors: "肌膚粉、霧白", visual: 0.6 },
  { id: "heaven", name: "天堂", motif: "灑下來的聖光", words: ["天堂", "天使", "上帝", "神明", "信仰", "祈禱", "救贖", "heaven", "angel", "angels", "god", "pray", "prayer", "faith", "holy"], scenes: ["gradient", "particles", "motif"], hues: [48, 210], saturation: 0.6, light: "bright", temperature: "warm", motion: "rise", emblem: "sun", colors: "聖光金、雲白", visual: 0.8 },
  { id: "war", name: "戰火", motif: "硝煙與火光", words: ["戰爭", "戰場", "炸彈", "爆炸", "硝煙", "戰", "war", "bomb", "battle", "explode"], scenes: ["shards", "ink", "tunnel"], hues: [5, 30], saturation: 0.8, light: "dark", temperature: "warm", motion: "burst", emblem: "shard", colors: "硝煙灰、火紅", visual: 0.9 },
  { id: "youth", name: "青春", motif: "夏天的操場", words: ["青春", "少年", "少女", "年輕", "十七歲", "十八歲", "校園", "教室", "操場", "youth", "young", "teenage", "school"], scenes: ["particles", "bokeh", "gradient"], hues: [175, 50], saturation: 0.85, light: "bright", temperature: "warm", motion: "rise", emblem: "bloom", colors: "青綠、夏日黃", visual: 0.7 },
  { id: "lonely", name: "孤獨", motif: "一個人的光點", words: ["孤獨", "孤單", "寂寞", "一個人", "獨自", "lonely", "alone", "loneliness", "solitude"], scenes: ["gradient", "rain", "nebula"], hues: [220, 250], saturation: 0.4, light: "dark", temperature: "cool", motion: "still", emblem: "orbit", colors: "冷灰藍、單一光點", visual: 0.6 },
  { id: "home", name: "故鄉", motif: "回家的燈", words: ["家鄉", "故鄉", "回家", "老家", "家人", "hometown", "homeland", "home"], scenes: ["bokeh", "gradient", "ink"], hues: [30, 40], saturation: 0.6, light: "mid", temperature: "warm", motion: "still", emblem: "bloom", colors: "暖橘燈、木色", visual: 0.8 },
  { id: "world", name: "世界", motif: "轉動的世界", words: ["世界", "全世界", "地球", "人間", "world", "earth"], scenes: ["nebula", "particles", "motif"], hues: [210, 190], saturation: 0.7, light: "mid", temperature: "cool", motion: "spin", emblem: "orbit", colors: "地球藍、雲白", visual: 0.6 },
];

/**
 * Round 14: the dark words (violence, weapons, blood, death, self-harm, drugs, sex). They still
 * colour the world through their symbolic families above, but the offline type design never
 * enlarges one as an emphasis and gives its line no motion word (no dripping, no splatter).
 */
export const SENSITIVE_WORDS: readonly string[] = [
  "鮮血", "血液", "流血", "血", "死亡", "死去", "死掉", "屍體", "墳墓", "墓碑", "骷髏", "葬禮", "自殺", "割腕", "自殘", "輕生",
  "傷口", "傷痕", "刀子", "刀鋒", "匕首", "殺死", "殺人", "謀殺", "暴力", "開槍", "子彈", "槍", "刀", "殺", "炸彈",
  "毒品", "嗑藥", "吸毒", "藥丸", "大麻", "做愛", "上床", "赤裸", "裸體", "情慾",
  "blood", "bleed", "bleeding", "dying", "dead", "death", "corpse", "corpses", "grave", "graves", "coffin", "skull", "skulls", "suicide", "suicidal",
  "wound", "wounds", "kill", "killing", "killer", "murder", "knife", "knives", "blade", "gun", "guns", "bullet", "bullets", "shoot", "violence", "violent", "bomb",
  "drug", "drugs", "pill", "pills", "cocaine", "heroin", "sex", "naked", "nude", "lust",
];

/**
 * Common words that contain an image character but are not the image (they are consumed whole by
 * the tokenizer). 永遠 is not a distance, 腦海 not the sea, 花錢 not a flower.
 */
export const STOP_WORDS: readonly string[] = [
  "今天", "明天", "每天", "天天", "聊天", "整天", "當天", "那天", "有天", "哪天", "一天", "某天", "天真", "天才", "天氣", "天生",
  "大家", "開心", "小心", "關心", "擔心", "放心", "用心", "耐心", "決心", "中心", "專心", "安心", "虛心", "良心", "野心", "信心", "心情",
  "花錢", "花費", "花了", "花光", "明星", "電影", "電話", "電腦", "精神", "神經", "浪費", "風格", "風險", "風景", "作風", "威風",
  "一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "月份", "光是", "上海", "水準", "水平", "國家", "海報",
  "腦海", "人海", "永遠", "遠遠", "出路", "絕路", "門檻", "專門", "部門", "熱門", "冷門", "冷靜", "冷漠", "相信", "信任", "自信",
  "字幕", "著火", "光臨", "時光機", "眼光", "眼前", "眼看", "心疼", "心酸", "傷心", "真心", "痛心",
  "血拼", "殺價",
];
