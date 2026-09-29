// A small simplified -> traditional Chinese character map, only for *matching*: the free research
// compares lyrics against 繁中 lexicons and artist names across MusicBrainz and Wikipedia, and many
// songs (and search results) are written in simplified characters. Stored text is never converted.
// Ambiguous one-to-many characters map to their most common traditional form in lyrics
// (发 -> 發, 后 -> 後, 里 -> 裡); for matching that is good enough.

const PAIRS =
  "爱愛罢罷备備贝貝笔筆边邊变變标標别別宾賓补補参參惨慘灿燦层層产產长長尝嘗场場车車彻徹尘塵陈陳称稱诚誠迟遲虫蟲丑醜础礎处處" +
  "传傳创創纯純词詞从從聪聰错錯达達带帶单單担擔胆膽当當党黨导導岛島灯燈敌敵递遞点點电電垫墊钓釣调調东東动動冻凍斗鬥独獨读讀" +
  "断斷队隊对對夺奪堕墮恶惡儿兒尔爾发發罚罰范範飞飛废廢费費纷紛坟墳奋奮愤憤风風丰豐凤鳳妇婦复復负負该該盖蓋赶趕刚剛钢鋼纲綱" +
  "岗崗个個给給巩鞏贡貢沟溝构構购購顾顧关關观觀馆館惯慣广廣归歸规規轨軌贵貴国國过過汉漢号號贺賀后後红紅护護华華画畫话話怀懷" +
  "坏壞欢歡环環还還换換唤喚黄黃挥揮辉輝汇匯会會绘繪伙夥获獲货貨祸禍机機积積击擊鸡雞极極级級几幾记記纪紀际際济濟继繼夹夾价價" +
  "驾駕坚堅间間艰艱监監减減检檢简簡见見渐漸剑劍键鍵将將奖獎讲講酱醬胶膠骄驕娇嬌脚腳觉覺较較阶階节節结結洁潔尽盡紧緊进進惊驚" +
  "经經静靜镜鏡竞競旧舊举舉剧劇惧懼据據军軍开開恳懇夸誇块塊亏虧扩擴来來蓝藍篮籃览覽懒懶烂爛劳勞乐樂类類泪淚离離礼禮里裡丽麗" +
  "历歷厉厲励勵连連联聯恋戀炼煉练練凉涼两兩辆輛疗療猎獵临臨邻鄰灵靈岭嶺龄齡领領刘劉龙龍楼樓录錄陆陸虑慮乱亂轮輪论論罗羅马馬" +
  "骂罵买買卖賣满滿猫貓么麼门門们們梦夢弥彌庙廟灭滅鸣鳴谋謀难難脑腦闹鬧内內拟擬鸟鳥宁寧农農浓濃盘盤贫貧苹蘋凭憑评評扑撲铺鋪" +
  "齐齊骑騎启啟气氣弃棄迁遷钱錢浅淺墙牆抢搶桥橋亲親轻輕倾傾请請庆慶穷窮区區驱驅趋趨权權劝勸确確让讓热熱认認荣榮软軟锐銳润潤" +
  "洒灑伞傘丧喪扫掃杀殺纱紗伤傷赏賞烧燒绍紹设設摄攝审審声聲胜勝绳繩圣聖师師诗詩时時识識实實势勢视視适適释釋寿壽书書输輸属屬" +
  "树樹数數帅帥双雙谁誰顺順说說丝絲诉訴虽雖随隨岁歲孙孫损損缩縮锁鎖态態叹嘆汤湯讨討题題体體条條铁鐵听聽厅廳头頭图圖团團涂塗" +
  "万萬湾灣网網为為伟偉围圍违違卫衛稳穩问問无無务務雾霧误誤牺犧习習戏戲细細吓嚇鲜鮮闲閒显顯险險现現线線献獻乡鄉响響项項协協" +
  "写寫谢謝兴興须須许許续續选選学學寻尋训訓压壓鸭鴨亚亞严嚴盐鹽颜顏艳豔阳陽养養样樣谣謠药藥爷爺页頁业業叶葉医醫仪儀艺藝亿億" +
  "忆憶义義议議阴陰银銀隐隱应應樱櫻鹰鷹营營拥擁忧憂优優邮郵犹猶鱼魚与與语語狱獄园園员員圆圓缘緣远遠愿願约約跃躍云雲运運韵韻" +
  "杂雜灾災载載赞讚脏髒则則泽澤责責贼賊赠贈张張涨漲帐帳账賬赵趙这這针針阵陣镇鎮争爭睁睜挣掙证證郑鄭织織执執纸紙质質钟鐘终終" +
  "种種众眾轴軸昼晝猪豬烛燭嘱囑筑築专專转轉庄莊装裝壮壯状狀准準资資总總纵縱组組钻鑽遗遺飘飄滚滾摇搖摆擺烟煙烬燼闪閃锈鏽链鏈" +
  "齿齒颤顫脸臉肤膚呜嗚哑啞呐吶喷噴轰轟啸嘯鸽鴿鹤鶴鲸鯨虾蝦龟龜狮獅驴驢鹅鵝萤螢蚁蟻兰蘭莲蓮厦廈滩灘涌湧涛濤汹洶涡渦渊淵烫燙" +
  "温溫晒曬晓曉晖暉暂暫绿綠铜銅宝寶坠墜荡蕩绕繞缠纏绑綁脱脫毁毀缝縫愈癒魂魂祷禱诺諾侣侶败敗赢贏陷陷弹彈麦麥闻聞谈談谎謊骗騙" +
  "虚虛残殘辈輩妈媽孙孫厌厭腾騰钥鑰匙匙窝窩宫宮帘簾碍礙缓緩湿濕灿燦烁爍诀訣赌賭赎贖挂掛锣鑼篱籬屿嶼岩岩溃潰涩澀浊濁" +
  "没沒吗嗎着著于於够夠迹跡刹剎闭閉冲衝战戰枪槍讯訊频頻丢丟忏懺恼惱烦煩慑懾飒颯岚嵐霁霽晕暈郁鬱伪偽疯瘋饿餓饥飢泼潑涟漣纹紋" +
  "净淨锦錦绣繡绸綢缎緞钮鈕袜襪峦巒涧澗砾礫陨隕坛壇珑瓏琼瓊芦蘆苇葦蔷薔绽綻舰艦桨槳码碼缤繽缱繾绻綣绵綿绪緒维維络絡统統纠糾" +
  "编編缚縛绝絕厂廠挚摯侠俠锋鋒铠鎧恒恆愤憤谜謎滞滯诞誕蕴蘊怅悵惆惆黯黯";

const S2T: ReadonlyMap<string, string> = (() => {
  const chars = Array.from(PAIRS);
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < chars.length; i += 2) if (chars[i] !== chars[i + 1]) map.set(chars[i], chars[i + 1]);
  return map;
})();

/** The text with the simplified characters this map knows replaced by traditional ones. */
export function toTraditional(text: string): string {
  let out = "";
  for (const ch of text) out += S2T.get(ch) ?? ch;
  return out;
}

/** A comparison key for names: width / case folded, traditional characters, no spaces or punctuation. */
export function nameKey(text: string): string {
  return toTraditional(String(text ?? "").normalize("NFKC").toLowerCase()).replace(/[\s\p{P}\p{S}]+/gu, "");
}
